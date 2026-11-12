// ロールと鍵盤の配置の計算（手本: App/Views/GuideRoll.swift の GuideRollLayout、
// 鍵の並びは SoundEngine の JPKeyboardUI/KeyboardView.swift の KeyboardGeometry）。
// 描画から独立した純粋関数。鍵盤（React）とロール（canvas）が同じ関数で同じ鍵・同じ列を選ぶ。
// 13 鍵 × 2 台には対応しない。
import type { KeyRange } from './keyRange'

/** 音名（0 = C 〜 11 = B） */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// MARK: - 鍵の並び（KeyboardGeometry）

/** 黒鍵の幅（白鍵幅に対する割合） */
export const BLACK_WIDTH_RATIO = 0.6
/** 黒鍵の高さ（鍵盤の高さに対する割合） */
export const BLACK_HEIGHT_RATIO = 0.62

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

/** 黒鍵か */
export function isBlack(note: number): boolean {
  return BLACK_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

/** 黒鍵 1 本。whiteIndex の白鍵の右隣に重なる */
export interface BlackKey {
  readonly note: number
  readonly whiteIndex: number
}

/** 鍵盤の鍵の並び */
export interface KeyboardGeometry {
  /** 白鍵のノート番号（左から順） */
  readonly whiteNotes: readonly number[]
  /** 黒鍵（低い順） */
  readonly blackKeys: readonly BlackKey[]
  /** この鍵盤で弾ける全ノート */
  readonly allNotes: ReadonlySet<number>
}

/** 最低音と白鍵の数から鍵の並びを作る。最低音が黒鍵なら次の白鍵から数える。右端の白鍵の右には黒鍵を置かない */
export function keyboardGeometry(lowestNote: number, whiteKeyCount: number): KeyboardGeometry {
  const whites: number[] = []
  const blacks: BlackKey[] = []
  let note = lowestNote
  while (isBlack(note)) note += 1
  while (whites.length < Math.max(0, whiteKeyCount) && note <= 127) {
    whites.push(note)
    const next = note + 1
    if (isBlack(next) && whites.length < whiteKeyCount && next + 1 <= 127) {
      blacks.push({ note: next, whiteIndex: whites.length - 1 })
      note += 2
    } else {
      note += 1
    }
  }
  return {
    whiteNotes: whites,
    blackKeys: blacks,
    allNotes: new Set([...whites, ...blacks.map((b) => b.note)]),
  }
}

/** 鍵の位置。x は左端、width は鍵の幅（鍵どうしの隙間は引かない）。鍵盤の描画用 */
export interface KeyRect {
  readonly note: number
  readonly black: boolean
  readonly x: number
  readonly width: number
}

/** 鍵盤の鍵の x 位置と幅（白鍵 → 黒鍵の順）。白鍵幅 = width ÷ 白鍵数、黒鍵は白鍵の境目を中心に白鍵幅 × 0.6 */
export function keyRects(geometry: KeyboardGeometry, width: number): KeyRect[] {
  const count = geometry.whiteNotes.length
  if (count === 0) return []
  const whiteW = Math.max(0, width) / count
  const rects: KeyRect[] = geometry.whiteNotes.map((note, i) => ({
    note,
    black: false,
    x: whiteW * i,
    width: whiteW,
  }))
  const blackW = whiteW * BLACK_WIDTH_RATIO
  for (const key of geometry.blackKeys) {
    rects.push({ note: key.note, black: true, x: whiteW * (key.whiteIndex + 1) - blackW / 2, width: blackW })
  }
  return rects
}

// MARK: - 列

/** 1 本の列。centerX は中心、width は棒の幅 */
export interface Column {
  readonly centerX: number
  readonly width: number
}

/** 鍵の端とロールの端の差。鍵盤の外枠の余白を左右へはみ出させて鍵の端をロールの端にそろえるので 0 */
export const KEYBOARD_INSET = 0
/** 判定線の下端からの距離。線（太さ 3）が下端にくっつき、すぐ下の鍵盤の上端に接する */
export const JUDGE_MARGIN = 1.5
/** 1 秒あたりの高さ（px） */
export const POINTS_PER_SECOND = 90
/** 棒の最小の長さ（音名が入る高さ） */
export const MIN_BAR_LENGTH = 16
/** 白鍵の列の棒は白鍵幅からこれを引いた幅。鍵どうしの隙間と同じ値で、棒と鍵の幅が揃う */
export const WHITE_BAR_GAP = 1.5
/** 黒鍵の列の棒の幅（白鍵幅に対する割合） */
export const BLACK_BAR_RATIO = 0.6
/** 音名を出す棒の最小の幅。これより細い棒は音名が収まらないので出さない */
export const MIN_LABEL_BAR_WIDTH = 24

/** 棒に音名を出すか */
export function showsLabel(barWidth: number): boolean {
  return barWidth >= MIN_LABEL_BAR_WIDTH
}

/** 鍵盤全体で音名を出すか。一番細い棒（黒鍵の列）に収まらないなら、白鍵の列にも出さず揃える */
export function showsLabels(columns: ReadonlyMap<number, Column>): boolean {
  if (columns.size === 0) return false
  let narrowest = Infinity
  for (const c of columns.values()) narrowest = Math.min(narrowest, c.width)
  return showsLabel(narrowest)
}

/** 求めた鍵の並びから列を作る。width は鍵盤全体の幅（内側の余白を含む） */
export function columnsFromGeometry(geometry: KeyboardGeometry, width: number): Map<number, Column> {
  const whites = geometry.whiteNotes
  const result = new Map<number, Column>()
  if (whites.length === 0) return result
  const inner = Math.max(0, width - KEYBOARD_INSET * 2)
  const whiteW = inner / whites.length
  whites.forEach((note, i) => {
    result.set(note, {
      centerX: KEYBOARD_INSET + whiteW * (i + 0.5),
      width: Math.max(0, whiteW - WHITE_BAR_GAP),
    })
  })
  // 黒鍵は、左隣の白鍵と右隣の白鍵の境目に置く
  for (const key of geometry.blackKeys) {
    result.set(key.note, {
      centerX: KEYBOARD_INSET + whiteW * (key.whiteIndex + 1),
      width: whiteW * BLACK_BAR_RATIO,
    })
  }
  return result
}

/** 鍵盤の各鍵（ノート番号）の列 */
export function columns(lowest: number, whiteKeyCount: number, width: number): Map<number, Column> {
  return columnsFromGeometry(keyboardGeometry(lowest, whiteKeyCount), width)
}

// MARK: - 鍵への振り替え

function resolveWith(
  note: number,
  lowest: number,
  highest: number,
  hasColumn: (candidate: number) => boolean,
): number | null {
  if (lowest > highest) return null
  // 区域内で列があればそのまま
  if (note >= lowest && note <= highest && hasColumn(note)) return note
  // 候補は lowest 以上で同じ音名の最初の音から 12 ずつ（低い方から見るので、同じ距離なら低い方が残る）
  let candidate = lowest + ((((note % 12) - (lowest % 12)) % 12) + 12) % 12
  let best: number | null = null
  let bestDistance = Infinity
  while (candidate <= highest) {
    const distance = Math.abs(candidate - note)
    if (hasColumn(candidate) && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
    candidate += 12
  }
  return best
}

/** 音を [lowest, highest] の区域の鍵に振り替える。区域内の鍵はすべてある前提（光らせる鍵を決めるのに使う）。
 * 範囲内ならそのまま。はみ出すなら同じ音名で一番近い鍵（同じ距離なら低い方）。無ければ null */
export function resolve(note: number, lowest: number, highest: number): number | null {
  return resolveWith(note, lowest, highest, () => true)
}

/** 音を [lowest, highest] の区域の鍵に振り替える。区域内で columns にある同じ音名のうち一番近い鍵（同じ距離なら低い方）。
 * 区域内に同じ音名の列が無ければ null（描かない） */
export function resolveInColumns(
  note: number,
  cols: ReadonlyMap<number, Column>,
  lowest: number,
  highest: number,
): number | null {
  return resolveWith(note, lowest, highest, (c) => cols.has(c))
}

/** 音を鍵盤の範囲内の鍵に振り替える（resolveInColumns の区域が鍵盤の範囲全体） */
export function resolveInKeyRange(
  note: number,
  columns: ReadonlyMap<number, Column>,
  keyRange: KeyRange,
): number | null {
  return resolveInColumns(note, columns, keyRange.lowest, keyRange.highest)
}

// MARK: - 手の区域

/** ロールに描く手 */
export type GuideRollHands =
  /** 右手の音だけ（1 手モード） */
  | { kind: 'rightOnly' }
  /** 両手を 1 つのロールに描く。右手は [lowestRight, 最高音]、左手は [最低音, lowestRight − 1]。lowestRight は C か F の白鍵を想定 */
  | { kind: 'split'; lowestRight: number }
  /** 左手の音だけを鍵盤全体で描く */
  | { kind: 'leftOnly' }

/** 1 つの手が受け持つ区域（両端を含む） */
export interface Zone {
  readonly lowest: number
  readonly highest: number
}

/** 手ごとの区域。その手が無ければ null。split は右が [lowestRight, highest]、左が [lowest, lowestRight − 1] */
export function zones(
  hands: GuideRollHands,
  lowest: number,
  highest: number,
): { right: Zone | null; left: Zone | null } {
  const whole: Zone = { lowest, highest }
  switch (hands.kind) {
    case 'rightOnly':
      return { right: whole, left: null }
    case 'leftOnly':
      return { right: null, left: whole }
    case 'split': {
      const lowestRight = hands.lowestRight
      const right = lowestRight <= highest ? { lowest: Math.max(lowest, lowestRight), highest } : null
      const left = lowestRight > lowest ? { lowest, highest: Math.min(highest, lowestRight - 1) } : null
      return { right, left }
    }
  }
}

/** 両手の境目（lowestRight の白鍵の左端）の x。lowestRight が黒鍵なら、その次の白鍵の左端。
 * 左右どちらにも区域があるとき（境目が先頭の白鍵より右、かつ範囲内）だけ返し、それ以外は null。
 * whites は鍵盤の白鍵のノート番号（低い順） */
export function boundaryX(lowestRight: number, whites: readonly number[], width: number): number | null {
  const index = whites.findIndex((n) => n >= lowestRight)
  if (index <= 0) return null
  const whiteW = Math.max(0, width - KEYBOARD_INSET * 2) / whites.length
  return KEYBOARD_INSET + whiteW * index
}

// MARK: - 棒の濃さ

/** 次のステップの棒の濃さ。少しだけ透かして、後ろの区切り線が見えるようにする */
export const NEXT_OPACITY = 0.85
/** 先のステップの棒の濃さ。遠さによらず同じにする */
export const OTHER_OPACITY = 0.25
/** 済んだステップの棒の濃さ。押したら消す */
export const PLAYED_OPACITY = 0

/** 濃さを前の値から今の値へ progress（0〜1）で混ぜる */
export function blend(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

/** 棒の濃さ。stepsAhead は次のステップから何ステップ先か（0 = 次、負 = 済んだ）。
 * 次は判定線への近づき具合 approach（0〜1）で OTHER_OPACITY から NEXT_OPACITY へ明るくする */
export function barOpacity(stepsAhead: number, approach = 1): number {
  if (stepsAhead === 0) return blend(OTHER_OPACITY, NEXT_OPACITY, approach)
  return stepsAhead < 0 ? PLAYED_OPACITY : OTHER_OPACITY
}

/** 音名の濃さ。済んだ棒は音名も消す */
export function labelOpacity(stepsAhead: number): number {
  return stepsAhead < 0 ? 0 : 1
}

/** 判定線に届いたとみなす時刻の差（秒）。最後のステップの hold が曲の長さの少し手前に丸められる分を含める */
export const REACH_TOLERANCE = 0.005

/** 次のステップの棒が判定線に届いたか（0 か 1）。届いた瞬間に切り替える */
export function approach(time: number, position: number): number {
  return time - REACH_TOLERANCE - position <= 0 ? 1 : 0
}

/** 済んだ棒を消さないとき（自動演奏中）は、済んだ棒（stepsAhead < 0）も判定線に届いた次の棒と同じ段階にする */
export function displayedStepsAhead(stepsAhead: number, keepsPlayed: boolean): number {
  return keepsPlayed && stepsAhead < 0 ? 0 : stepsAhead
}

/** 棒の段階。今のステップでも、もう押した音名の棒は済んだ棒として描く */
export function barStepsAhead(stepsAhead: number, collected: boolean): number {
  return stepsAhead === 0 && collected ? -1 : stepsAhead
}

/** ロールの濃さを決める状態。待っているステップと、そこで押した音名（右・左。bit n = ピッチクラス n） */
export interface Progress {
  readonly stepIndex: number
  readonly collectedMask: number
  readonly collectedLeftMask: number
}

/** その手の音が押した音名か */
export function isCollected(progress: Progress, note: number, left: boolean): boolean {
  const mask = left ? progress.collectedLeftMask : progress.collectedMask
  return ((mask >> note % 12) & 1) !== 0
}

/** 音名を押したときやステップが 1 つ進んだとき、棒と音名の濃さを前の値から今の値へ移す時間（秒） */
export const FADE_DURATION = 0.4

/** フェードの進み具合（0〜1）。フェードしていない（null）か、時間を過ぎたら 1 */
export function fadeProgress(elapsed: number | null): number {
  if (elapsed === null) return 1
  return Math.min(Math.max(elapsed / FADE_DURATION, 0), 1)
}

/** フェードするか。同じステップで押した音名が変わったときと、1 ステップ進んだときだけ */
export function fades(previous: Progress, current: Progress): boolean {
  if (
    previous.stepIndex === current.stepIndex &&
    previous.collectedMask === current.collectedMask &&
    previous.collectedLeftMask === current.collectedLeftMask
  ) {
    return false
  }
  return current.stepIndex === previous.stepIndex || current.stepIndex === previous.stepIndex + 1
}

// MARK: - 時間軸

/** 判定線の y */
export function judgeY(height: number): number {
  return height - JUDGE_MARGIN
}

/** ステップの縦の範囲。bottom は time が position と同じなら判定線に接する。上が小さい y */
export function vertical(
  time: number,
  endTime: number,
  position: number,
  height: number,
): { top: number; bottom: number } {
  const bottom = judgeY(height) - (time - position) * POINTS_PER_SECOND
  const length = Math.max((endTime - time) * POINTS_PER_SECOND, MIN_BAR_LENGTH)
  return { top: bottom - length, bottom }
}

/** 描く対象の先頭の添字（time 順の times に対する二分探索）。これより前のステップは棒の上端まで判定線の下に抜けて見えない。
 * 閾値を「最も長い棒の長さ」だけ手前にずらすので、見えないものを少し残すことはある（描く側で飛ばす）。
 * longestLength は最も長いステップの長さ（秒）。最小の棒の長さより短ければ、そちらを使う */
export function firstVisibleIndex(
  times: readonly number[],
  longestLength: number,
  position: number,
  _height: number,
): number {
  const maxLength = Math.max(longestLength, MIN_BAR_LENGTH / POINTS_PER_SECOND)
  const threshold = position - JUDGE_MARGIN / POINTS_PER_SECOND - maxLength
  let low = 0
  let high = times.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (times[mid] < threshold) low = mid + 1
    else high = mid
  }
  return low
}

/** time に一番近いステップの添字（times は time 順。同じ距離なら前のステップ。空なら 0）。ドラッグで移る先を決める */
export function nearestStep(time: number, times: readonly number[]): number {
  let low = 0
  let high = times.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (times[mid] < time) low = mid + 1
    else high = mid
  }
  if (low >= times.length) return Math.max(times.length - 1, 0)
  if (low > 0 && time - times[low - 1] <= times[low] - time) return low - 1
  return low
}

/** ロールのドラッグでの位置（秒）。下へ動かすと棒が判定線へ近づくので進む。最初と最後のステップの時刻の間に収める */
export function draggedPosition(start: number, translation: number, times: readonly number[]): number {
  if (times.length === 0) return start
  return Math.min(Math.max(start + translation / POINTS_PER_SECOND, times[0]), times[times.length - 1])
}

/** これより後ろのステップは画面の上に外れる（time がこれ以下のものを描く） */
export function lastVisibleTime(position: number, height: number): number {
  return position + judgeY(height) / POINTS_PER_SECOND
}
