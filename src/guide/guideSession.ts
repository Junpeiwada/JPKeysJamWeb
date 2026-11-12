// 判定（手本: App/Guide/GuideSession.swift）。
// 弾いた音名でステップを進め、伴奏を次のステップの手前で止めるガイド。
// JS は 1 スレッドなのでロックは持たない。「判定して鳴らす音を返す」は voiced が 1 回で行う。
// 13 鍵 × 2 台の機器による分け方（byChannel・送り先 ch・routing）は移さない。
// 前提: 伴奏の sink（SmfPlayer の出力）から voiced / released には戻らない（伴奏を弾いた音として判定しないため）。
import { performanceClock } from '../audio/smfPlayer'
import type { PlayerClock, SmfPlayer } from '../audio/smfPlayer'
import type { SmfSong } from '../midi/smf'
import { DEFAULT_CHORD_WINDOW, GuideScore } from './guideScore'
import { handFor } from './hand'
import type { Hand, HandSplit, PlayHands } from './hand'

/** 自動演奏（お手本）の状態 */
export type GuideAutoplay =
  /** 自動演奏していない（弾くのを待つ、いつもの判定） */
  | 'off'
  /** 鍵を押さなくても、弾く手のパートも鳴らして曲が流れている */
  | 'playing'
  /** 自動演奏が曲の最後まで流れて止まっている */
  | 'finished'

/** 演奏画面が毎フレーム読む、ガイドの表示用の値 */
export interface GuideSnapshot {
  /** 今待っているステップの番号（0 始まり）。弾き終えたら stepCount と同じ */
  readonly stepIndex: number
  readonly stepCount: number
  /** 今のステップで、もう押された音名（ビット n = ピッチクラス n） */
  readonly collectedMask: number
  /** 今のステップで、もう押された左手の音名（両手のときだけ値がある） */
  readonly collectedLeftMask: number
  /** そろった音名（ピッチクラス） */
  readonly collectedPitchClasses: ReadonlySet<number>
  /** そろった左手の音名（ピッチクラス） */
  readonly collectedLeftPitchClasses: ReadonlySet<number>
  /** 違う鍵として押している鍵（MIDI ノート番号）のうち、左手の機器（ch 番号 1）から来たもの */
  readonly wrongHeldLeft: ReadonlySet<number>
  /** 違う鍵として押している鍵のうち、右手の機器（ch 番号 1 以外）から来たもの */
  readonly wrongHeldRight: ReadonlySet<number>
  /** 違う鍵として押している鍵（両手の和） */
  readonly wrongHeldNotes: ReadonlySet<number>
  /** 違う鍵を押した回数 */
  readonly wrongCount: number
  /** 最後のステップを弾き終えたか */
  readonly isFinished: boolean
  /** 開始からの経過時間（秒）。弾き終えるか止めたらそこで止まる。一時停止中の時間は含めない */
  readonly elapsed: number
  /** 最後のステップを弾いたあと、伴奏も最後まで鳴り終えたか（「弾き終わり」の表示に使う） */
  readonly isComplete: boolean
  /** 一時停止中か */
  readonly isPaused: boolean
  /** 今の判定が右手だけ・左手だけ・両手のどれか（左手の音が無い曲では、頼んでも rightOnly のまま） */
  readonly hands: PlayHands
  /** 自動演奏の状態。off 以外の間、stepIndex は伴奏の位置以降で最初のステップ */
  readonly autoplay: GuideAutoplay
  /** 正しい音を弾いてステップを進めた回数。シーク・手の切り替え・自動演奏では増えない（最初からで 0 に戻る） */
  readonly advancedSteps: number
}

/** 違う鍵として押している鍵（MIDI ノート番号）を、入力の手（右 = ch 番号 1 以外、左 = ch 番号 1）ごとに返す */
export function wrongHeldNotesOf(snapshot: GuideSnapshot, hand: Hand): ReadonlySet<number> {
  return hand === 'left' ? snapshot.wrongHeldLeft : snapshot.wrongHeldRight
}

/** 伴奏より先へ進みすぎないための判定の値 */
export class GuidePacing {
  /** 本番の値。間隔の後半 50%（0.1〜0.5 秒）で受け付け、60ms の押しずれをまとめる */
  static readonly standard = new GuidePacing(0.5, 0.1, 0.5, 0.06)
  /** 時刻を見ない（伴奏の位置に関係なく次のステップへ進める。テスト用） */
  static readonly off = new GuidePacing(0, Infinity, Infinity, 0)

  /**
   * @param approachRatio 次のステップを受け付け始める窓の、前のステップ（先頭は曲の頭）からの間隔に対する割合
   * @param minWindow 窓の下限（秒）。間隔が下限より短いところでは、前のステップを済ませた直後から受け付ける
   * @param maxWindow 窓の上限（秒）
   * @param chordGrace ステップが進んでからこの秒数以内に押した、済んだステップの同じ手の音名は、
   *   済んだステップの続き（和音の押しずれ）として扱う
   */
  constructor(
    readonly approachRatio: number,
    readonly minWindow: number,
    readonly maxWindow: number,
    readonly chordGrace: number,
  ) {}

  /** 前のステップからの間隔 gap（秒）に対する窓の幅（秒） */
  window(gap: number): number {
    return Math.min(Math.max(gap * this.approachRatio, this.minWindow), this.maxWindow)
  }
}

export interface GuideSessionOptions {
  /** 弾くパート（右手）のチャンネル（0 始まり）。伴奏の再生ではミュートする。既定 0 */
  playChannel?: number
  /** 左手のチャンネル（0 始まり）。ここに音が無い曲では両手にできない。既定 1 */
  leftChannel?: number
  /** 最初の手。左手の音が無い曲では右手だけになる。既定 rightOnly */
  hands?: PlayHands
  /** 入力から手を決める方法（両手のときだけ使う）。既定 none */
  split?: HandSplit
  /** 経過時間の計測に使う時計。既定は performance.now */
  clock?: PlayerClock
  /** 伴奏より先へ進みすぎないための判定の値。既定 standard */
  pacing?: GuidePacing
  /**
   * 楽譜の列を直接渡す（Swift の init(score:player:song:)）。右手だけ・手を分けない GuideSession になり、
   * hands・split・leftChannel は無視する
   */
  score?: GuideScore
}

/** 1 つの鍵で鳴らす音の最大数 */
const MAX_VOICES = 4

/** 同じ音が既にあるか、いっぱいなら足さない */
function appendVoice(list: number[], note: number): void {
  if (list.length >= MAX_VOICES || list.includes(note)) return
  list.push(note)
}

/** 判定に使う列（右手だけ・左手だけ・両手のどれか）と、事前計算 */
class Lane {
  readonly score: GuideScore
  /** 各ステップの右手・左手の音名マスク（12 ビット） */
  readonly rightMasks: readonly number[]
  readonly leftMasks: readonly number[]
  readonly times: readonly number[]

  /** @param withLeft 左手の音名もマスクにする（右手だけの列では 0） */
  constructor(score: GuideScore, song: SmfSong, withLeft: boolean) {
    this.score = score
    const mask = (classes: ReadonlySet<number>): number => {
      let m = 0
      for (const c of classes) m |= 1 << c
      return m
    }
    this.rightMasks = score.steps.map((s) => mask(s.pitchClasses))
    this.leftMasks = score.steps.map((s) => (withLeft ? mask(s.leftPitchClasses) : 0))
    // 曲の長さ以上の時刻は SmfPlayer の hold が効かず、最後のステップを弾く前に伴奏が終わってしまうので、手前に丸める
    const latestHold = Math.max(song.duration - 0.001, 0)
    this.times = score.steps.map((s) => Math.min(s.time, latestHold))
  }
}

interface State {
  running: boolean
  stepIndex: number
  /** 正しい音を弾いてステップを進めた回数（judge だけが増やす。start の State 作り直しで 0 に戻る） */
  advancedSteps: number
  /** 今のステップで集めた右手の音名（左手だけのときは左手の音名） */
  collected: number
  /** 今のステップで集めた左手の音名（両手のときだけ） */
  collectedLeft: number
  /** 選んだ手（左手の音がある曲だけ rightOnly 以外になる）。split が none の間は両手の列で判定しないが、選んだ手は覚えておく */
  requested: PlayHands
  /** 今、判定している列。弾き終えたあとや動いていないときは選んだ手に追いつかず、次の start で揃う */
  active: PlayHands
  /** 入力から手を決める方法（両手のときだけ使う） */
  split: HandSplit
  wrongCount: number
  /** 違う鍵として押している鍵。入力の ch で右（ch 番号 1 以外）・左（ch 番号 1）に分ける */
  wrongRight: Set<number>
  wrongLeft: Set<number>
  /** 始めた時刻。null なら start 前（経過時間は 0、弾き終えた扱いにしない） */
  startedAt: number | null
  /** 弾き終えた、または止めた時刻。null なら経過時間は進み続ける */
  endedAt: number | null
  /** 一時停止中か。true の間は入力で進めず、伴奏は止まっている */
  paused: boolean
  /** 一時停止を始めた時刻。paused の間だけ値がある */
  pausedAt: number | null
  /** これまでに一時停止していた時間の合計（秒）。経過時間から引く */
  pausedTotal: number
  /** 最後のステップのあと、伴奏が最後まで鳴り終えた */
  complete: boolean
  /** 1 音で OK: 手ごとに正しい音名を 1 つ押せば、その手の残りの音名も押したことにする */
  oneNote: boolean
  /** 直前のステップ（stepIndex - 1）を済ませた押鍵の続きとして扱う期限（clock の秒）。null なら扱わない */
  graceUntil: number | null
  /** 自動演奏の状態。off 以外の間は判定せず、hold も書かない（stepIndex は使わず、snapshot が伴奏の位置から求める） */
  autoplay: GuideAutoplay
}

/** 選んだ手と分け方から決まる、判定に使う列（split が none なら両手にしない） */
function desiredHands(state: State): PlayHands {
  return state.requested === 'both' && state.split.kind === 'none' ? 'rightOnly' : state.requested
}

/** 位置（秒）とみなす幅。hold で止まっている位置とステップの時刻のずれを吸収する */
const POSITION_TOLERANCE = 0.001

/** 弾いた音名でステップを進め、伴奏を次のステップの手前で止めるガイド。画面へは通知せず、snapshot() を画面が読む */
export class GuideSession {
  private readonly rightLane: Lane
  private readonly leftLane: Lane
  private readonly bothLane: Lane
  /** 左手の ch に音があるか。false なら左手だけ・両手にしようとしても右手だけのまま */
  readonly canPlayBothHands: boolean
  private readonly player: SmfPlayer
  private readonly song: SmfSong
  private readonly playChannel: number
  private readonly leftChannel: number
  private readonly clock: PlayerClock
  private readonly pacing: GuidePacing
  private state: State
  /** 押した鍵（右 = 0〜127、左（ch 番号 1）= 128〜255）→ 鳴らした音（最大 4 音）。voiced だけが使う */
  private readonly sounding = new Map<number, number[]>()
  /** 送り先の ch（右 = 0〜127、左 = 128〜255 の bucket）と音ごとの、いま押されている鍵の数。索引は bucket * 128 + 音 */
  private readonly refCount = new Map<number, number>()

  /**
   * @param song 曲
   * @param player 伴奏の再生（ミュートと hold をここへ書く）
   * @param options 弾くパート・手・時計・判定の値。`score` を渡すと右手だけ・手を分けない列で作る
   */
  constructor(song: SmfSong, player: SmfPlayer, options: GuideSessionOptions = {}) {
    this.player = player
    this.song = song
    this.clock = options.clock ?? performanceClock
    this.pacing = options.pacing ?? GuidePacing.standard
    this.playChannel = options.playChannel ?? 0
    let hands: PlayHands
    let split: HandSplit
    if (options.score) {
      const lane = new Lane(options.score, song, false)
      this.rightLane = lane
      this.leftLane = lane
      this.bothLane = lane
      this.canPlayBothHands = false
      this.leftChannel = 1
      hands = 'rightOnly'
      split = { kind: 'none' }
    } else {
      this.leftChannel = options.leftChannel ?? 1
      this.rightLane = new Lane(new GuideScore(song, { playChannel: this.playChannel }), song, false)
      this.leftLane = new Lane(new GuideScore(song, { playChannel: this.leftChannel }), song, false)
      this.bothLane = new Lane(
        new GuideScore(song, { playChannel: this.playChannel, leftChannel: this.leftChannel }),
        song,
        true,
      )
      this.canPlayBothHands = GuideScore.hasNotes(song, this.leftChannel)
      hands = options.hands ?? 'rightOnly'
      split = options.split ?? { kind: 'none' }
    }
    const initial = this.newState()
    initial.requested = this.canPlayBothHands ? hands : 'rightOnly'
    initial.split = split
    initial.active = desiredHands(initial)
    this.state = initial
  }

  private newState(): State {
    return {
      running: false,
      stepIndex: 0,
      advancedSteps: 0,
      collected: 0,
      collectedLeft: 0,
      requested: 'rightOnly',
      active: 'rightOnly',
      split: { kind: 'none' },
      wrongCount: 0,
      wrongRight: new Set(),
      wrongLeft: new Set(),
      startedAt: null,
      endedAt: null,
      paused: false,
      pausedAt: null,
      pausedTotal: 0,
      complete: false,
      oneNote: false,
      graceUntil: null,
      autoplay: 'off',
    }
  }

  // MARK: - 列の読み出し

  /** 演奏画面のロールが読む。今の手の列。列と stepIndex を合わせたいときは `scoreFor(snapshot.hands)` を使う */
  get score(): GuideScore {
    return this.lane(this.state.active).score
  }

  /** 手に応じた列。左手の音が無い曲では、どれを渡しても右手だけの列（Swift の score(for:)） */
  scoreFor(hands: PlayHands): GuideScore {
    return this.lane(this.canPlayBothHands ? hands : 'rightOnly').score
  }

  private lane(hands: PlayHands): Lane {
    switch (hands) {
      case 'rightOnly':
        return this.rightLane
      case 'leftOnly':
        return this.leftLane
      case 'both':
        return this.bothLane
    }
  }

  private stepCount(hands: PlayHands): number {
    return this.lane(hands).times.length
  }

  /** そのステップの時刻（秒）。範囲外は null */
  private holdTime(hands: PlayHands, index: number): number | null {
    const times = this.lane(hands).times
    return index >= 0 && index < times.length ? times[index] : null
  }

  /** そのステップの右手・左手の音名マスク */
  private masks(hands: PlayHands, index: number): { right: number; left: number } {
    const lane = this.lane(hands)
    return { right: lane.rightMasks[index], left: lane.leftMasks[index] }
  }

  /** そのステップの入力を受け付け始める伴奏の位置（秒）。前のステップ（先頭は曲の頭）からの間隔で決まる窓の幅だけ手前 */
  private opensAt(hands: PlayHands, index: number): number {
    const time = this.holdTime(hands, index)
    if (time === null) return 0
    const previous = index > 0 ? (this.holdTime(hands, index - 1) ?? 0) : 0
    return time - this.pacing.window(time - previous)
  }

  /** 手に応じてミュートする ch（右手だけ: 右手の ch、左手だけ: 左手の ch、両手: 右手と左手の ch） */
  private mutedChannelsFor(hands: PlayHands): ReadonlySet<number> {
    switch (hands) {
      case 'rightOnly':
        return new Set([this.playChannel])
      case 'leftOnly':
        return new Set([this.leftChannel])
      case 'both':
        return new Set([this.playChannel, this.leftChannel])
    }
  }

  // MARK: - 開始・停止・一時停止

  /** 曲を読み込み、最初のステップの手前まで再生する。経過時間の計測を始める */
  start(): void {
    this.player.load(this.song)
    // 伴奏が最後まで鳴り終えたら完了にする
    this.player.onFinished = () => this.markComplete()
    const now = this.clock.now()
    // 押した鍵の表（sounding）は空にしない。表は「押した鍵 → engine に送った音」で、曲をやり直しても押したままの鍵の離し方は変わらない
    // 手と分け方・1 音で OK は start 前に決めた値を引き継ぐ（State を作り直すので、読み出してから戻す）
    const kept = { requested: this.state.requested, split: this.state.split, oneNote: this.state.oneNote }
    const state = this.newState()
    state.requested = kept.requested
    state.split = kept.split
    state.oneNote = kept.oneNote
    state.active = desiredHands(state)
    state.running = true
    state.startedAt = now
    if (this.stepCount(state.active) === 0) state.endedAt = now
    this.state = state
    this.player.mutedChannels = this.mutedChannelsFor(state.active)
    this.player.hold = this.holdTime(state.active, 0)
    this.player.play()
  }

  /** 最初からやり直す。鳴っている音の停止は呼び出し側が allNotesOff で行う */
  restart(): void {
    this.state.running = false
    this.player.stop()
    this.start()
  }

  /** 止める。以後の入力は進みに使わない。押した鍵の表は空にしない（押したままの鍵を離したとき、押したときの音を止められる） */
  stop(): void {
    this.player.onFinished = null
    const now = this.clock.now()
    const state = this.state
    state.running = false
    // 一時停止中に止めたら、一時停止を始めた時刻で経過時間を止める
    if (state.endedAt === null) state.endedAt = state.pausedAt ?? now
    this.player.stop()
  }

  /**
   * 伴奏を今の位置で止め、入力で進まないようにする（設定シートを開いている間など）。
   * 伴奏が鳴り終えたあと・止めたあと・すでに一時停止中なら何もしない。鳴っている音は止まる（resume で続きの音から鳴る）
   */
  pause(): void {
    const now = this.clock.now()
    const state = this.state
    if (!state.running || state.complete || state.paused) return
    state.paused = true
    state.pausedAt = now
    state.graceUntil = null
    // 位置は player が保つ。hold は stop で null に戻るので、resume で付け直す
    this.player.stop()
  }

  /** pause で止めた伴奏を、元の hold に戻して続ける */
  resume(): void {
    const now = this.clock.now()
    const state = this.state
    if (!state.running || !state.paused) return
    state.paused = false
    // 弾き終えたあとの一時停止は経過時間に影響しない（endedAt で止まっている）
    if (state.endedAt === null && state.pausedAt !== null) state.pausedTotal += Math.max(now - state.pausedAt, 0)
    state.pausedAt = null
    // 自動演奏は hold を付けずに続ける。最後まで流れたあとは鳴らさない
    if (state.autoplay !== 'off') {
      if (state.autoplay === 'playing' && this.player.position < this.song.duration) this.player.play()
      return
    }
    // 伴奏がもう最後まで鳴り終えているなら play しない（SmfPlayer.play は終端から先頭に戻して鳴り直すため）。
    // 最後のステップを弾き終えていて onFinished がまだ届いていなければ、ここで完了にする
    if (state.complete) return
    const atEnd = this.player.position >= this.song.duration
    if (atEnd && state.stepIndex >= this.stepCount(state.active)) {
      state.complete = true
      return
    }
    // play() の前に hold を戻し、止まるべき位置を越えて鳴らさない
    this.player.hold = this.holdTime(state.active, state.stepIndex)
    this.player.play()
  }

  /**
   * 待つステップを toStep に移す（進み具合のバー・ロールのドラッグ）。
   * 伴奏はそのステップの時刻へ移して止め、弾いたらそこから続ける。集めた音名は空にし、違う鍵の回数と経過時間は保つ。
   * toStep は先頭から最後のステップまでに丸める（弾き終えた扱いにはしない）。
   * 動いていない・一時停止中・伴奏が鳴り終えたあとは何もしない。
   * 自動演奏中はそのステップの時刻へ移って hold を付けずに続ける。自動演奏が最後まで流れたあとは、弾くのを待つ状態に戻してから移る
   */
  seek(toStep: number): void {
    if (this.state.autoplay === 'finished') this.stopAutomatically()
    const now = this.clock.now()
    const state = this.state

    if (state.autoplay === 'playing') {
      const count = this.stepCount(state.active)
      if (!state.running || state.paused || count === 0) return
      const target = Math.min(Math.max(toStep, 0), count - 1)
      const time = this.holdTime(state.active, target) ?? 0
      this.player.stop()
      this.player.seek(time)
      this.player.play()
      return
    }

    if (!state.running || state.paused || state.complete) return
    const count = this.stepCount(state.active)
    if (count === 0) return
    // 弾き終えて伴奏の残りが鳴っている間に戻したら、経過時間をまた進める（止まっていた分は数えない）
    if (state.stepIndex >= count && state.endedAt !== null) {
      state.pausedTotal += Math.max(now - state.endedAt, 0)
      state.endedAt = null
    }
    const target = Math.min(Math.max(toStep, 0), count - 1)
    state.stepIndex = target
    state.collected = 0
    state.collectedLeft = 0
    state.graceUntil = null
    const time = this.holdTime(state.active, target)
    if (time === null) return
    // 先に止めてから位置と hold を書く。seek は hold を外すので、鳴らしたまま seek すると hold を書くまでの間に
    // 再生側がそのステップの伴奏を送ってしまう。伴奏が鳴り終えて止まっていても、ここから鳴らし直す
    this.player.stop()
    this.player.seek(time)
    this.player.hold = time
    this.player.play()
  }

  // MARK: - 入力（判定と音の差し替え）

  /**
   * noteOn の判定と、鳴らす音の決定を 1 回で行う。鳴らす音（MIDI ノート番号）を順に返す。
   * 判定は音名だけだが、鳴らす高さは楽譜に合わせる:
   * 待っているステップに押した音名があれば、そのステップの同じ音名の楽譜の音を全部（最大 4 音）鳴らす。無ければ押した鍵のまま 1 音。
   * ステップが進んだら hold を更新する（ここでは player の sink から voiced へ戻らない）。
   * 同じ鍵を離さずに押し直したときは、先に鳴らした音を使い続ける（止め漏れを作らない）。
   * 送る ch は呼び出し側が入力の ch のままにする。
   *
   * 手の振り分け・1 音で OK・時刻（GuidePacing）の規則:
   * - 右手だけ・左手だけのときは手を見ずに全部その手として判定する（左手だけの列は左手の音を右手側に持つ）。
   *   両手のときは split で入力の手を決め、その手の音名だけを数える。右手と左手の音名が両方そろったらステップを進める
   * - 1 音で OK のときは、正しい音名を 1 つ押せばその手の音名を全部集めたことにし、その手の楽譜の音を全部鳴らす
   * - ステップが進んでから chordGrace 以内に、済んだステップにある同じ手の音名を押したら、済んだステップの続きとして
   *   その楽譜の音を鳴らし、今のステップには使わない（和音の押しずれで次のステップまで済ませない）
   * - 伴奏の位置が、待っているステップの受け付け始め（opensAt）より前なら、押した鍵のまま鳴らし、
   *   違う鍵にも数えず進めない（伴奏を追い越して先の楽譜へ進めない）
   * - 動いていない・一時停止中・自動演奏中・弾き終えたあとは判定せず、押した鍵のまま
   */
  voiced(channel: number, note: number): number[] {
    if (!(note >= 0 && note < 128)) return [note]
    const now = this.clock.now()
    const { targets, advanced } = this.judge(channel, note, now, this.player.position)
    const played = this.press(GuideSession.slot(channel, note), targets)
    if (advanced) this.syncHold()
    return played
  }

  /**
   * noteOff（と velocity 0 の noteOn）。止める音（MIDI ノート番号）を返す。違う鍵の押下中の表示も消す。
   * 押したときに鳴らした音をすべて止める。ほかの鍵がまだ同じ音を鳴らしていればその音は返さない（止めるとその鍵の音まで切れるため）。
   * 覚えていない鍵は押した鍵のまま 1 音返す
   */
  released(channel: number, note: number): number[] {
    if (!(note >= 0 && note < 128)) return [note]
    this.noteUp(channel, note)
    const stopped = this.release(GuideSession.slot(channel, note))
    return stopped ?? [note]
  }

  /**
   * All Notes Off / All Sound Off（CC123・CC120）。押した鍵の表を空にし、違う鍵の印を消す。
   * エンジンの音が全部止まるので、表に残すと次に同じ音へ差し替えた鍵の参照数が合わなくなる。
   * channel が null なら両方の手、ch 番号 1 は左、それ以外の ch は右の違う鍵の印を消す
   */
  allNotesOff(channel: number | null): void {
    this.sounding.clear()
    this.refCount.clear()
    const state = this.state
    if (channel === null || channel === 1) state.wrongLeft.clear()
    if (channel === null || channel !== 1) state.wrongRight.clear()
  }

  /** 押した鍵の表の索引。入力の ch だけで決める（押している間に setSplit されてもずれない） */
  private static slot(channel: number, note: number): number {
    return (channel === 1 ? 128 : 0) + note
  }

  /** 押した鍵の索引から送り先の bucket（右 = 0、左 = 1）を取り出す */
  private static bucketOf(key: number): number {
    return key >= 128 ? 1 : 0
  }

  /** 鍵を押したときの音を覚える。既に押している鍵なら覚え直さず、先に鳴らした音を返す */
  private press(key: number, targets: readonly number[]): number[] {
    const existing = this.sounding.get(key)
    if (existing) return [...existing] // 離さずに押し直し: 参照数は増やさない
    const list = [...targets]
    this.sounding.set(key, list)
    const bucket = GuideSession.bucketOf(key)
    for (const n of list) {
      const index = bucket * 128 + n
      this.refCount.set(index, (this.refCount.get(index) ?? 0) + 1)
    }
    return [...list]
  }

  /** 鍵を離す。参照数が 0 になった音を返す。覚えていない鍵は null */
  private release(key: number): number[] | null {
    const list = this.sounding.get(key)
    if (!list) return null
    this.sounding.delete(key)
    const stopped: number[] = []
    const bucket = GuideSession.bucketOf(key)
    for (const n of list) {
      const index = bucket * 128 + n
      const left = (this.refCount.get(index) ?? 1) - 1
      if (left <= 0) {
        this.refCount.delete(index)
        appendVoice(stopped, n)
      } else {
        this.refCount.set(index, left)
      }
    }
    return stopped
  }

  /** 違う鍵の押下中の表示を消す（noteOff・velocity 0 の noteOn） */
  private noteUp(channel: number, note: number): void {
    const state = this.state
    if (channel === 1) state.wrongLeft.delete(note)
    else state.wrongRight.delete(note)
  }

  /**
   * noteOn の判定。集めた音名・違う鍵の回数・ステップの進みを決め、鳴らす音も同じステップから選ぶ。
   * 戻り値は（鳴らす音, ステップが進んだか）
   */
  private judge(channel: number, note: number, now: number, position: number): { targets: number[]; advanced: boolean } {
    const state = this.state
    const hands = state.active
    const count = this.stepCount(hands)
    if (!state.running || state.paused || state.autoplay !== 'off' || state.stepIndex >= count) {
      return { targets: [note], advanced: false }
    }
    const index = state.stepIndex
    const hand: Hand = hands === 'both' ? handFor(state.split, note) : 'right'
    const bit = 1 << (note % 12)
    if (state.graceUntil !== null && now < state.graceUntil && index > 0) {
      const done = this.masks(hands, index - 1)
      if (((hand === 'right' ? done.right : done.left) & bit) !== 0) {
        return { targets: this.scoreNotes(hands, index - 1, hand, note), advanced: false }
      }
    }
    if (position < this.opensAt(hands, index)) return { targets: [note], advanced: false }
    const wanted = this.masks(hands, index)
    const wantedHand = hand === 'right' ? wanted.right : wanted.left
    if ((wantedHand & bit) === 0) {
      state.wrongCount += 1
      if (channel === 1) state.wrongLeft.add(note)
      else state.wrongRight.add(note)
      return { targets: [note], advanced: false }
    }
    const targets = this.scoreNotes(hands, index, hand, note)
    // 1 音で OK: その手の音名を全部集めたことにし、その手の楽譜の音も全部鳴らす（押した音名の音を先に入れてあるので、4 音を超えても押した音は鳴る）
    const collect = state.oneNote ? wantedHand : bit
    if (state.oneNote) this.scoreChord(hands, index, hand, targets)
    if (hand === 'right') state.collected |= collect
    else state.collectedLeft |= collect
    if ((state.collected & wanted.right) !== wanted.right || (state.collectedLeft & wanted.left) !== wanted.left) {
      return { targets, advanced: false }
    }
    state.stepIndex += 1
    state.advancedSteps += 1
    state.collected = 0
    state.collectedLeft = 0
    state.graceUntil = now + this.pacing.chordGrace
    if (state.stepIndex >= count) state.endedAt = now
    return { targets, advanced: true }
  }

  /** そのステップの、押した鍵と同じ音名の、その手の楽譜の音（最大 4 音）。無ければ押した鍵そのまま */
  private scoreNotes(hands: PlayHands, index: number, hand: Hand, note: number): number[] {
    const step = this.lane(hands).score.steps[index]
    const candidates = hand === 'right' ? step.notes : step.leftNotes
    const result: number[] = []
    for (const candidate of candidates) {
      if (candidate % 12 === note % 12 && candidate < 128) appendVoice(result, candidate)
    }
    return result.length === 0 ? [note] : result
  }

  /** そのステップの、その手の楽譜の音を全部 result に足す（最大 4 音まで） */
  private scoreChord(hands: PlayHands, index: number, hand: Hand, result: number[]): void {
    const step = this.lane(hands).score.steps[index]
    const candidates = hand === 'right' ? step.notes : step.leftNotes
    for (const candidate of candidates) {
      if (candidate < 128) appendVoice(result, candidate)
    }
  }

  // MARK: - 設定

  /** 1 音で OK を切り替える。演奏中に呼んでよい。今のステップの次の正しい押鍵から効く。start・restart をまたいで保つ */
  setOneNote(on: boolean): void {
    this.state.oneNote = on
  }

  /**
   * 右手だけ／左手だけ／両手を切り替える。演奏中に呼んでよい。左手の音が無い曲では右手だけのまま。
   * 分け方が none の間は両手の列で判定しないが、選んだ手は覚えておき、setSplit で none 以外になったら両手になる。
   * 動いていて弾き終えていなければ、今待っているステップの時刻の少し手前（同じまとまりのずれ）から、新しい列で最初のステップへ移る（位置は戻らない）。
   * 集めた音名（右・左）は空にし、違う鍵の押下中の表示と回数・経過時間は保つ。
   * ミュートを付け替え（弾く手の ch を止め、ほかを鳴らす）、一時停止中でなければ hold を新しい列の時刻に書く
   * （一時停止中は resume が書く）。動いていない・弾き終えたあとは選んだ手だけを覚え、列・ステップ・player には触らない（次の start が使う）
   */
  setHands(hands: PlayHands): void {
    this.apply(this.canPlayBothHands ? hands : 'rightOnly', null)
  }

  /**
   * 入力から手を決める方法を替える。演奏中に呼んでよい。両手のときだけ効く。
   * 両手を選んでいて none から替えたとき、または none に替えたときは列が切り替わる（setHands と同じ移り方）
   */
  setSplit(split: HandSplit): void {
    this.apply(null, split)
  }

  /** 選んだ手・分け方を state に書き、判定する列が変わるなら setHands の規則でステップを移す */
  private apply(requested: PlayHands | null, split: HandSplit | null): void {
    const now = this.clock.now()
    const atEnd = this.player.position >= this.song.duration
    const state = this.state
    if (requested !== null) state.requested = requested
    if (split !== null) state.split = split
    const newHands = desiredHands(state)
    if (newHands === state.active) return
    // 自動演奏中は列だけ替える（ステップは伴奏の位置から求め、ミュートは外したまま。止めたときに付け直す）
    if (state.autoplay !== 'off') {
      state.active = newHands
      return
    }
    const oldCount = this.stepCount(state.active)
    if (!state.running || state.stepIndex >= oldCount) {
      // start 前だけは表示用の手を合わせる。止めた・弾き終えたあとは次の start まで列を変えない
      if (state.startedAt === null) state.active = newHands
      return
    }
    const target = this.holdTime(state.active, state.stepIndex) ?? 0
    const newCount = this.stepCount(newHands)
    // 新しい列で、同じ時刻（まとまりの先頭のずれを含む）以降の最初のステップ。無ければ弾き終えた扱い
    const lower = target - DEFAULT_CHORD_WINDOW - 1e-6
    let next = newCount
    for (let i = 0; i < newCount; i++) {
      if ((this.holdTime(newHands, i) ?? 0) >= lower) {
        next = i
        break
      }
    }
    state.active = newHands
    state.stepIndex = next
    state.collected = 0
    state.collectedLeft = 0
    state.graceUntil = null
    if (next >= newCount) {
      if (state.endedAt === null) state.endedAt = state.pausedAt ?? now
      if (atEnd) state.complete = true
    }
    this.player.mutedChannels = this.mutedChannelsFor(newHands)
    if (!state.paused) this.player.hold = this.holdTime(newHands, next)
  }

  // MARK: - 表示用

  /** 表示用 */
  snapshot(): GuideSnapshot {
    const now = this.clock.now()
    const state = this.state
    const count = this.stepCount(state.active)
    const stepIndex = state.autoplay === 'off' ? state.stepIndex : this.firstStep(state.active, this.player.position)
    const classes = (mask: number): Set<number> => {
      const set = new Set<number>()
      for (let pc = 0; pc < 12; pc++) if ((mask >> pc) & 1) set.add(pc)
      return set
    }
    return {
      stepIndex,
      stepCount: count,
      collectedMask: state.collected,
      collectedLeftMask: state.collectedLeft,
      collectedPitchClasses: classes(state.collected),
      collectedLeftPitchClasses: classes(state.collectedLeft),
      wrongHeldLeft: new Set(state.wrongLeft),
      wrongHeldRight: new Set(state.wrongRight),
      wrongHeldNotes: new Set([...state.wrongLeft, ...state.wrongRight]),
      wrongCount: state.wrongCount,
      isFinished: state.startedAt !== null && state.stepIndex >= count,
      elapsed:
        state.startedAt !== null
          ? Math.max((state.endedAt ?? state.pausedAt ?? now) - state.startedAt - state.pausedTotal, 0)
          : 0,
      isComplete: state.complete,
      isPaused: state.paused,
      hands: state.active,
      autoplay: state.autoplay,
      advancedSteps: state.advancedSteps,
    }
  }

  // MARK: - 自動演奏

  /** 位置（秒）以降で最初のステップ。無ければ stepCount */
  private firstStep(hands: PlayHands, position: number): number {
    let low = 0
    let high = this.stepCount(hands)
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if ((this.holdTime(hands, mid) ?? 0) < position - POSITION_TOLERANCE) low = mid + 1
      else high = mid
    }
    return low
  }

  /**
   * 自動演奏を始める。今の位置から、弾く手のパートも鳴らして流す。判定はしない。
   * 最後まで流れて止まっていたら先頭から（SmfPlayer.play が戻す）。設定シートで一時停止中なら、状態だけ替えて resume で鳴らす。
   * 動いていない・弾き終えたあと（complete）・自動演奏中は何もしない
   */
  playAutomatically(): void {
    const state = this.state
    if (!state.running || state.complete || state.autoplay === 'playing') return
    state.autoplay = 'playing'
    state.collected = 0
    state.collectedLeft = 0
    state.graceUntil = null
    // ミュートを外してから hold を外す（hold で止まっていた位置ちょうどの、弾く手の音も鳴らす）
    this.player.mutedChannels = new Set()
    this.player.hold = null
    if (!state.paused) this.player.play()
  }

  /**
   * 自動演奏をやめ、今の位置以降で最初のステップから弾くのを待つ。最後まで流れていたら先頭のステップから。
   * 集めた音名は空にし、違う鍵の回数と経過時間は保つ。自動演奏していなければ何もしない
   */
  stopAutomatically(): void {
    const state = this.state
    if (!state.running || state.autoplay === 'off') return
    const position = this.player.position
    state.autoplay = 'off'
    const hands = state.active
    const count = this.stepCount(hands)
    let index = this.firstStep(hands, position)
    const rewinds = index >= count
    if (rewinds) index = 0
    state.stepIndex = index
    state.collected = 0
    state.collectedLeft = 0
    state.graceUntil = null
    // 弾き終えたあとに自動演奏していたなら、また弾けるよう経過時間を進め直す
    if (index < count) state.endedAt = null
    this.player.stop()
    this.player.mutedChannels = this.mutedChannelsFor(hands)
    if (rewinds) this.player.seek(0)
    // 設定シートで一時停止中なら、resume が hold を書いて鳴らす
    if (state.paused) return
    this.player.hold = this.holdTime(hands, index)
    this.player.play()
  }

  // MARK: - 内部

  /**
   * いまの state から求めた最新の hold を player に書く。
   * 動いていない（止めた・start 前）間と一時停止中・自動演奏中は player.hold を書かない（resume が正しい hold を書く）。
   * なお player の出力は判定に通さない約束で、通すと伴奏を弾いた音として判定してしまう
   */
  private syncHold(): void {
    const state = this.state
    if (!state.running || state.paused || state.autoplay !== 'off') return
    this.player.hold = this.holdTime(state.active, state.stepIndex)
  }

  /**
   * 伴奏が最後まで鳴り終えたとき、player から呼ばれる。
   * 最後のステップを弾き終えていなければ（restart 直後の古い通知など）無視する。
   * 自動演奏が最後まで流れたときは、弾き終えた扱いにせず finished にする
   */
  private markComplete(): void {
    const state = this.state
    if (!state.running) return
    if (state.autoplay === 'playing') {
      state.autoplay = 'finished'
      return
    }
    if (state.autoplay !== 'off' || state.stepIndex < this.stepCount(state.active)) return
    state.complete = true
  }
}
