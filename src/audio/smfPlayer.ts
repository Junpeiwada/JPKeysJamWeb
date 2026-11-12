// SMF の再生。手本は SoundEngine の JPMIDIKit/SMFPlayer.swift（hold・holdReleaseDelay・mutedChannels・seek・onFinished・tick は同じ意味）。
// Swift との違い:
// - 再生スレッドの代わりに setInterval で tick() を呼ぶ（usesTimer=false なら呼ばない。テストが手で tick する）
// - JS は 1 スレッドなのでロックは無い。sink の中から API を呼んでも固まらないが、順序が崩れるので呼ばないこと
// - seek(to:) は seek(seconds) に、usesThread は usesTimer にした
// - ポリプレッシャー・チャンネルプレッシャー・AllNotesOff は MidiMessage に無いので扱わない
import type { MidiMessage } from '../midi/types'
import type { SmfSong } from '../midi/smf'

/** 秒を返す時計。単調増加。テストでは手で進める偽物に差し替える */
export interface PlayerClock {
  now(): number
}

/** 実機の単調増加時計 */
export const performanceClock: PlayerClock = {
  now: () => performance.now() / 1000,
}

export type PlayerSink = (message: MidiMessage) => void

export interface SmfPlayerOptions {
  clock?: PlayerClock
  /** 既定 true。false ならタイマーを作らず、呼び出し側が tick() で進める（テスト用） */
  usesTimer?: boolean
  /** tick の間隔（ミリ秒）。既定 5 */
  intervalMs?: number
}

const EMPTY_SONG: SmfSong = {
  title: null,
  events: [],
  duration: 0,
  usedChannels: new Set(),
  initialPrograms: new Map(),
  trackNames: new Map(),
}

export class SmfPlayer {
  private readonly sink: PlayerSink
  private readonly clock: PlayerClock
  private readonly usesTimer: boolean
  private readonly intervalMs: number

  private song: SmfSong = EMPTY_SONG
  /** 次に送るイベントの添字 */
  private index = 0
  private playing = false
  /** anchorClock の時点での曲内位置（秒） */
  private basePosition = 0
  private anchorClock = 0
  private muted = new Set<number>()
  /** プレイヤーが鳴らしている音。添字は ch * 128 + note（16 × 128 固定） */
  private sounding: boolean[] = new Array<boolean>(16 * 128).fill(false)
  /** 前回の無音化のあとに、プレイヤーが何か送った ch。無音化の CC64・ピッチベンド送出の対象を絞る */
  private sentChannels: boolean[] = new Array<boolean>(16).fill(false)
  /** 止まる時刻（秒）。null なら最後まで。曲の長さ以上は無効（止まらない） */
  private holdValue: number | null = null
  /** hold に達して止まっている間 true。時計は進めず、position は basePosition のまま */
  private held = false
  /** hold で止まってから、鳴らしている音を止めるまでの秒数。null なら止まっている間ずっと伸ばす */
  private holdReleaseDelayValue: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  /** 曲が最後まで行って止まったときに呼ぶ（stop() では呼ばない） */
  onFinished: (() => void) | null = null

  /** sink の中から SmfPlayer の API（play・stop・seek・hold など）を呼ばないこと */
  constructor(sink: PlayerSink, options: SmfPlayerOptions = {}) {
    this.sink = sink
    this.clock = options.clock ?? performanceClock
    this.usesTimer = options.usesTimer ?? true
    this.intervalMs = options.intervalMs ?? 5
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** 曲内の位置（秒） */
  get position(): number {
    return this.positionAt(this.clock.now())
  }

  /** hold に達して止まっているか（再生中のときだけ true） */
  get isHeld(): boolean {
    return this.playing && this.held
  }

  /**
   * 止まる時刻（秒）。再生中に位置が達すると、時刻がこの値ちょうどの事象は送らずに止まり、時計を進めない（鳴っている音は伸ばしたまま）。
   * 止まっている間に先の時刻へ変える、または null にすると、その場から続ける。
   * 続けるとき、時刻が止まっていた位置ちょうどの事象は、この呼び出しの中で同期的に sink へ送る。
   * 曲の長さ以上は止まらない。止まっている間に現在位置以下の値へ変えても、その場で止まったまま（位置は戻らない）。
   * 再生中（held でない）に現在位置より前の値にすると、次の tick でその時刻へ戻って止まる（送った事象は取り消さない）。
   * stop()・seek()・load() で null に戻る。負の値と NaN などの非有限値は無視する
   */
  get hold(): number | null {
    return this.holdValue
  }

  set hold(value: number | null) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    this.holdValue = value
    if (!this.playing || !this.held) return
    // まだ今の位置で止めるなら何もしない
    const limit = this.effectiveHold()
    if (limit !== null && limit <= this.basePosition) return
    this.held = false
    this.anchorClock = this.clock.now()
    this.sendEventsDue()
  }

  /**
   * hold で止まってから、プレイヤーが鳴らしている音に noteOff を送るまでの秒数。null（既定）なら止まっている間ずっと伸ばす。
   * 止めた音は、続けても鳴らし直さない。負の値と NaN などの非有限値は無視する
   */
  get holdReleaseDelay(): number | null {
    return this.holdReleaseDelayValue
  }

  set holdReleaseDelay(value: number | null) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    this.holdReleaseDelayValue = value
  }

  get mutedChannels(): ReadonlySet<number> {
    return this.muted
  }

  set mutedChannels(value: ReadonlySet<number>) {
    // 新しくミュートされた ch で、プレイヤーが鳴らしている音だけ止める
    const added = [...value].filter((channel) => !this.muted.has(channel)).sort((a, b) => a - b)
    this.muted = new Set(value)
    const out: MidiMessage[] = []
    for (const channel of added) {
      if (channel >= 0 && channel < 16) this.collectNoteOffs(channel, out)
    }
    this.emit(out)
  }

  /** 停止してから曲を差し替え、先頭に戻す */
  load(song: SmfSong): void {
    const now = this.clock.now()
    this.basePosition = this.positionAt(now)
    this.playing = false
    this.clearTimer()
    this.holdValue = null
    this.held = false
    const silence = this.silenceEvents()
    this.song = song
    this.index = 0
    this.basePosition = 0
    this.emit(silence)
  }

  /** 今の位置から再生する。最後まで行っていたら先頭から */
  play(): void {
    if (this.playing) return
    if (this.basePosition >= this.song.duration) {
      this.basePosition = 0
      this.index = 0
    }
    this.playing = true
    this.held = false
    this.anchorClock = this.clock.now()
    if (this.usesTimer) {
      this.clearTimer()
      this.timer = setInterval(() => {
        this.tick()
      }, this.intervalMs)
    }
  }

  /** 停止する。プレイヤーが鳴らしている音は止める */
  stop(): void {
    this.basePosition = this.positionAt(this.clock.now())
    this.playing = false
    this.clearTimer()
    this.holdValue = null
    this.held = false
    this.emit(this.silenceEvents())
  }

  /** 位置を変える。鳴っている音は止め、飛ばした区間の音色・CC・ピッチベンドを追いかけて送る。再生中ならそこから続ける */
  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return
    const out = this.silenceEvents()
    const target = Math.min(Math.max(seconds, 0), this.song.duration)
    this.basePosition = target
    this.anchorClock = this.clock.now()
    this.holdValue = null
    this.held = false
    // target 以降の最初のイベント
    let low = 0
    let high = this.song.events.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (this.song.events[mid].time < target) low = mid + 1
      else high = mid
    }
    this.index = low
    out.push(...this.catchUpEvents(low))
    this.emit(out)
  }

  /**
   * 時計を見て、時刻に達したイベントを送る。遅れた分はまとめて送る。最後まで行ったら停止状態にして onFinished を呼ぶ。
   * 戻り値は次のイベント（無ければ曲の終わり）までの秒数。停止中は 0.005
   */
  tick(): number {
    const result = this.advance(this.clock.now())
    this.emit(result.events)
    if (result.finished) {
      this.clearTimer()
      this.onFinished?.()
    }
    return result.wait
  }

  // MARK: - 内部

  private advance(now: number): { events: MidiMessage[]; finished: boolean; wait: number } {
    if (!this.playing) return { events: [], finished: false, wait: 0.005 }
    const out: MidiMessage[] = []
    if (this.held) {
      // 止まってから holdReleaseDelay 経ったら、伸ばしている音を止める（anchorClock は止まった時刻）
      if (this.holdReleaseDelayValue !== null && now - this.anchorClock >= this.holdReleaseDelayValue) {
        for (let channel = 0; channel < 16; channel++) this.collectNoteOffs(channel, out)
      }
      return { events: out, finished: false, wait: 0.005 }
    }
    const limit = this.effectiveHold()
    let target = this.positionAt(now)
    const reached = limit !== null && target >= limit
    if (reached && limit !== null) target = limit
    // hold ちょうどの事象は送らない
    while (this.index < this.song.events.length) {
      const timed = this.song.events[this.index]
      if (timed.time > target) break
      if (limit !== null && timed.time >= limit) break
      this.index += 1
      this.filter(timed.message, out)
    }
    if (reached && limit !== null) {
      // 時計を止める。以後 position は limit のまま
      this.held = true
      this.basePosition = limit
      this.anchorClock = now
      return { events: out, finished: false, wait: 0.005 }
    }
    if (this.index >= this.song.events.length && target >= this.song.duration) {
      this.playing = false
      this.basePosition = this.song.duration
      out.push(...this.silenceEvents())
      return { events: out, finished: true, wait: 0.005 }
    }
    let nextTime = this.index < this.song.events.length ? this.song.events[this.index].time : this.song.duration
    if (limit !== null) nextTime = Math.min(nextTime, limit)
    return { events: out, finished: false, wait: Math.max(nextTime - target, 0) }
  }

  private emit(messages: MidiMessage[]): void {
    for (const message of messages) this.sink(message)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 曲の長さより手前の hold だけ有効 */
  private effectiveHold(): number | null {
    if (this.holdValue === null || this.holdValue >= this.song.duration) return null
    return this.holdValue
  }

  /** 止まっていた位置（basePosition）ちょうどまでの事象を、今の呼び出しの中で sink へ送る。次の hold 以降の事象は送らない（tick に任せる） */
  private sendEventsDue(): void {
    for (;;) {
      if (!this.playing || this.held || this.index >= this.song.events.length) return
      const timed = this.song.events[this.index]
      if (timed.time > this.basePosition) return
      const limit = this.effectiveHold()
      if (limit !== null && timed.time >= limit) return
      this.index += 1
      const out: MidiMessage[] = []
      this.filter(timed.message, out)
      this.emit(out)
    }
  }

  /** 曲のイベント 1 つを、ミュートと発音中フラグを踏まえて out に積む。ミュート中の ch では「プレイヤーが鳴らしている音への Note Off」以外は送らない */
  private filter(message: MidiMessage, out: MidiMessage[]): void {
    const channel = message.channel
    if (channel < 0 || channel >= 16) return
    if (message.type === 'noteOn' && message.velocity > 0) {
      if (message.note < 0 || message.note >= 128 || this.muted.has(channel)) return
      this.sounding[channel * 128 + message.note] = true
      this.sentChannels[channel] = true
      out.push(message)
      return
    }
    // velocity 0 の noteOn は noteOff と同じ扱い
    if (message.type === 'noteOn' || message.type === 'noteOff') {
      if (message.note < 0 || message.note >= 128) return
      const slot = channel * 128 + message.note
      if (this.sounding[slot]) {
        this.sounding[slot] = false
        out.push(message)
      } else if (!this.muted.has(channel)) {
        out.push(message)
      }
      return
    }
    if (this.muted.has(channel)) return
    this.sentChannels[channel] = true
    out.push(message)
  }

  /** ch で鳴らしている音への noteOff を集め、フラグを落とす */
  private collectNoteOffs(channel: number, out: MidiMessage[]): void {
    const base = channel * 128
    for (let note = 0; note < 128; note++) {
      if (this.sounding[base + note]) {
        this.sounding[base + note] = false
        out.push({ type: 'noteOff', channel, note, velocity: 0 })
      }
    }
  }

  /**
   * 無音化のイベントを作る。鳴らしている音だけに noteOff を送り、CC64=0・ピッチベンド中央は、
   * 曲が使う ch のうちミュートしておらず何か送った ch にだけ送る
   */
  private silenceEvents(): MidiMessage[] {
    const out: MidiMessage[] = []
    for (let channel = 0; channel < 16; channel++) this.collectNoteOffs(channel, out)
    const channels = [...this.song.usedChannels].sort((a, b) => a - b)
    for (const channel of channels) {
      if (channel < 0 || channel >= 16) continue
      if (!this.sentChannels[channel] || this.muted.has(channel)) continue
      out.push({ type: 'controlChange', channel, controller: 64, value: 0 })
      out.push({ type: 'pitchBend', channel, value: 8192 })
    }
    this.sentChannels.fill(false)
    return out
  }

  /** 添字 end より前のイベントから、ch ごとの最後の Program Change・CC・ピッチベンドを集める（ミュート中の ch は除く） */
  private catchUpEvents(end: number): MidiMessage[] {
    const programs = new Map<number, number>()
    const controls = new Map<number, number>() // ch << 8 | controller
    const bends = new Map<number, number>()
    for (let i = 0; i < end; i++) {
      const message = this.song.events[i].message
      switch (message.type) {
        case 'programChange':
          programs.set(message.channel, message.program)
          break
        case 'controlChange':
          if (message.controller < 120) controls.set((message.channel << 8) | message.controller, message.value)
          break
        case 'pitchBend':
          bends.set(message.channel, message.value)
          break
        default:
          break
      }
    }
    const out: MidiMessage[] = []
    const ascending = (a: number, b: number): number => a - b
    for (const channel of [...programs.keys()].sort(ascending)) {
      if (channel < 0 || channel >= 16 || this.muted.has(channel)) continue
      out.push({ type: 'programChange', channel, program: programs.get(channel) ?? 0 })
      this.sentChannels[channel] = true
    }
    for (const key of [...controls.keys()].sort(ascending)) {
      const channel = key >> 8
      if (channel < 0 || channel >= 16 || this.muted.has(channel)) continue
      out.push({ type: 'controlChange', channel, controller: key & 0xff, value: controls.get(key) ?? 0 })
      this.sentChannels[channel] = true
    }
    for (const channel of [...bends.keys()].sort(ascending)) {
      if (channel < 0 || channel >= 16 || this.muted.has(channel)) continue
      out.push({ type: 'pitchBend', channel, value: bends.get(channel) ?? 8192 })
      this.sentChannels[channel] = true
    }
    return out
  }

  private positionAt(now: number): number {
    if (!this.playing || this.held) return this.basePosition
    return Math.min(this.basePosition + Math.max(now - this.anchorClock, 0), this.song.duration)
  }
}
