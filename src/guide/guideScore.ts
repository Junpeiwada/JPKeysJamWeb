// 楽譜のステップ（手本: App/Guide/GuideScore.swift）
import type { SmfSong } from '../midi/smf'

/** 曲の 1 ステップ（同時に押す音の集まり） */
export interface GuideStep {
  /** ステップの最初の noteOn の時刻（秒） */
  readonly time: number
  /** このステップの音のうち、最後に離れる時刻（秒） */
  readonly endTime: number
  /** 音の高さ（MIDI ノート番号、昇順・重複なし） */
  readonly notes: readonly number[]
  /** notes のピッチクラス（0〜11） */
  readonly pitchClasses: ReadonlySet<number>
  /** 左手（leftChannel）の音の高さ（昇順・重複なし）。右手だけの列では空 */
  readonly leftNotes: readonly number[]
  /** leftNotes のピッチクラス（0〜11） */
  readonly leftPitchClasses: ReadonlySet<number>
  /** notes の音ごとの鳴り終わりの時刻（秒。notes と同じ並び）。同じ高さが 2 つあれば遅いほう */
  readonly noteEnds: readonly number[]
  /** leftNotes の音ごとの鳴り終わりの時刻（秒。leftNotes と同じ並び） */
  readonly leftNoteEnds: readonly number[]
}

/** 同じステップにまとめる幅の既定値（秒）。列を切り替えるときの時刻のずれの許容にも使う */
export const DEFAULT_CHORD_WINDOW = 0.03

export interface GuideScoreOptions {
  /** 弾くパート（右手）のチャンネル（0 始まり）。既定 0 */
  playChannel?: number
  /** 左手のチャンネル。null なら右手だけの列。playChannel と同じ値なら全部右手として扱う */
  leftChannel?: number | null
  /** 最初の noteOn からこの秒数以内に始まる音を同じステップにまとめる（連鎖させない） */
  chordWindow?: number
}

interface Note {
  on: number
  off: number
  readonly number: number
  readonly isLeft: boolean
}

/** SmfSong の弾くパート（既定は ch1 = channel 0）をステップの列にしたもの */
export class GuideScore {
  /** 同じステップにまとめる幅の既定値（秒） */
  static readonly defaultChordWindow = DEFAULT_CHORD_WINDOW

  readonly steps: readonly GuideStep[]
  /** 各ステップの time（steps と同じ順）。二分探索で毎回配列を作らないよう一度だけ求める */
  readonly times: readonly number[]
  /** 最も長いステップの長さ（endTime - time の最大、秒）。ステップがなければ 0 */
  readonly longestLength: number

  /** その ch に noteOn（velocity > 0）が 1 つでもあるか。左手の無い曲の判定に使う */
  static hasNotes(song: SmfSong, channel: number): boolean {
    return song.events.some(
      (e) => e.message.type === 'noteOn' && e.message.channel === channel && e.message.velocity > 0,
    )
  }

  constructor(song: SmfSong, options: GuideScoreOptions = {}) {
    const playChannel = options.playChannel ?? 0
    const leftChannel = options.leftChannel ?? null
    const chordWindow = options.chordWindow ?? DEFAULT_CHORD_WINDOW

    // 1. 音の長さを求める（noteOn と、対応する noteOff の組）
    const notes: Note[] = []
    // 「左手か:ノート番号」→ 未終了の notes の添字（先に始まった順）
    const open = new Map<string, number[]>()

    /** ch がどの手の音か（true = 左手）。対象外なら null */
    const handOf = (channel: number): boolean | null => {
      if (channel === playChannel) return false
      if (leftChannel !== null && channel === leftChannel) return true
      return null
    }
    const keyOf = (isLeft: boolean, number: number) => `${isLeft ? 'L' : 'R'}:${number}`

    for (const timed of song.events) {
      const m = timed.message
      if (m.type !== 'noteOn' && m.type !== 'noteOff') continue
      const isLeft = handOf(m.channel)
      if (isLeft === null) continue
      const key = keyOf(isLeft, m.note)
      if (m.type === 'noteOn' && m.velocity > 0) {
        const list = open.get(key) ?? []
        list.push(notes.length)
        open.set(key, list)
        notes.push({ on: timed.time, off: song.duration, number: m.note, isLeft })
      } else {
        // velocity 0 の noteOn は noteOff 扱い。対応する noteOn が無ければ無視する
        const list = open.get(key)
        const index = list?.shift()
        if (index !== undefined) {
          notes[index].off = Math.max(timed.time, notes[index].on)
        }
      }
    }

    // 2. events が時刻順でない場合に備え、始まりの時刻で並べてまとめる（同時刻は元の順を保つ）
    const ordered = notes
      .map((note, offset) => ({ note, offset }))
      .sort((a, b) => a.note.on - b.note.on || a.offset - b.offset)
      .map((e) => e.note)

    const steps: GuideStep[] = []
    let index = 0
    while (index < ordered.length) {
      const start = ordered[index].on
      const group: Note[] = []
      while (index < ordered.length && ordered[index].on - start <= chordWindow + 1e-9) {
        group.push(ordered[index])
        index += 1
      }
      /** 手ごとの音の高さ（昇順・重複なし）と、高さごとの一番遅い鳴り終わり */
      const endsOf = (isLeft: boolean) => {
        const latest = new Map<number, number>()
        for (const n of group) {
          if (n.isLeft !== isLeft) continue
          latest.set(n.number, Math.max(latest.get(n.number) ?? n.off, n.off))
        }
        const numbers = [...latest.keys()].sort((a, b) => a - b)
        return { numbers, ends: numbers.map((x) => latest.get(x) ?? start) }
      }
      const right = endsOf(false)
      const left = endsOf(true)
      steps.push({
        time: start,
        endTime: group.reduce((max, n) => Math.max(max, n.off), start),
        notes: right.numbers,
        pitchClasses: new Set(right.numbers.map((n) => n % 12)),
        leftNotes: left.numbers,
        leftPitchClasses: new Set(left.numbers.map((n) => n % 12)),
        noteEnds: right.ends,
        leftNoteEnds: left.ends,
      })
    }
    this.steps = steps
    this.times = steps.map((s) => s.time)
    this.longestLength = steps.reduce((max, s) => Math.max(max, s.endTime - s.time), 0)
  }

  /** 位置（秒）で鳴っている音（鳴り始め ≦ 位置 < その音の鳴り終わり）。自動演奏中に光らせる鍵に使う */
  soundingNotes(position: number): { right: number[]; left: number[] } {
    const right: number[] = []
    const left: number[] = []
    for (const index of this.soundingSteps(position)) {
      const step = this.steps[index]
      step.notes.forEach((note, i) => {
        if (position < step.noteEnds[i]) right.push(note)
      })
      step.leftNotes.forEach((note, i) => {
        if (position < step.leftNoteEnds[i]) left.push(note)
      })
    }
    return { right, left }
  }

  /**
   * 位置（秒）で鳴っているステップ（time ≦ 位置 < endTime）の番号（昇順）。
   * time が位置以下の最後のステップから、longestLength より前に始まったものまでをさかのぼる
   */
  soundingSteps(position: number): number[] {
    let low = 0
    let high = this.times.length
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (this.times[mid] <= position) low = mid + 1
      else high = mid
    }
    const result: number[] = []
    let index = low - 1
    while (index >= 0 && this.times[index] >= position - this.longestLength) {
      if (position < this.steps[index].endTime) result.push(index)
      index -= 1
    }
    return result.reverse()
  }
}
