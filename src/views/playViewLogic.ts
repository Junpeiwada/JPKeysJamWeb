// 演奏画面の純粋な計算（手本: PlayView.swift の static 関数と FinishCard.timeText）。
// 画面・DOM・audio に触らないのでテストできる。
import type { GuideRollHands } from '../guide/rollLayout'
import { resolve } from '../guide/rollLayout'
import type { GuideSnapshot } from '../guide/guideSession'
import type { GuideStep } from '../guide/guideScore'
import type { Hand, PlayHands } from '../guide/hand'
import { KEYS13, keyCount } from '../guide/keyRange'
import type { KeyRange } from '../guide/keyRange'

/** 25 鍵の両手の境目。この音以上が右手、未満が左手（C4） */
export const LOWEST_RIGHT_NOTE = 60

/**
 * 次のステップの楽譜の音のうち、remaining の音名のものを、その手の区域の鍵 1 つずつにする。
 * ロールの棒と同じ規則（範囲内ならその高さ、はみ出すなら同じ音名で一番近い鍵）。
 * splitsByNote（25 鍵の両手）のときは右手を境目以上、左手を境目未満の区域にする
 */
export function guideNotes(
  notes: readonly number[],
  remaining: ReadonlySet<number>,
  range: KeyRange,
  hand: Hand,
  splitsByNote: boolean,
): Set<number> {
  let lowest = range.lowest
  let highest = range.highest
  if (splitsByNote) {
    if (hand === 'right') {
      lowest = Math.max(lowest, LOWEST_RIGHT_NOTE)
    } else {
      highest = Math.min(highest, LOWEST_RIGHT_NOTE - 1)
    }
  }
  const result = new Set<number>()
  for (const note of notes) {
    if (!remaining.has(((note % 12) + 12) % 12)) continue
    const key = resolve(note, lowest, highest)
    if (key !== null) result.add(key)
  }
  return result
}

/** 差集合 */
function subtract(a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> {
  const result = new Set<number>()
  for (const v of a) if (!b.has(v)) result.add(v)
  return result
}

/** いま光らせる鍵（右手と左手の和）。step が無い（弾き終えた）ときは空 */
export function guideNotesForStep(
  step: GuideStep | undefined,
  snapshot: Pick<GuideSnapshot, 'collectedPitchClasses' | 'collectedLeftPitchClasses' | 'hands'>,
  range: KeyRange,
): Set<number> {
  if (!step) return new Set()
  const splitsByNote = snapshot.hands === 'both'
  const right = guideNotes(
    step.notes,
    subtract(step.pitchClasses, snapshot.collectedPitchClasses),
    range,
    'right',
    splitsByNote,
  )
  const left = guideNotes(
    step.leftNotes,
    subtract(step.leftPitchClasses, snapshot.collectedLeftPitchClasses),
    range,
    'left',
    splitsByNote,
  )
  return new Set([...right, ...left])
}

/** ロールに描く手。判定中の列が両手のときだけ境目で左右に分け、ほかは鍵盤全体に描く */
export function rollHands(snapshotHands: PlayHands): GuideRollHands {
  return snapshotHands === 'both' ? { kind: 'split', lowestRight: LOWEST_RIGHT_NOTE } : { kind: 'rightOnly' }
}

/** 鍵盤が両手にできるか（25 鍵のように音の高さで手を分けられるとき） */
export function keyboardAllowsBothHands(range: KeyRange): boolean {
  return keyCount(range) > keyCount(KEYS13)
}

/** 手の表示名（左手・両手・右手） */
export function handsName(hands: PlayHands): string {
  switch (hands) {
    case 'leftOnly':
      return '左手'
    case 'both':
      return '両手'
    case 'rightOnly':
      return '右手'
  }
}

/** 手のボタンに出す手。左手の音が無い曲と、両手にできない鍵盤の両手は右手にする */
export function displayedHands(setting: PlayHands, hasLeftPart: boolean, allowsBoth: boolean): PlayHands {
  if (!hasLeftPart) return 'rightOnly'
  if (setting === 'both' && !allowsBoth) return 'rightOnly'
  return setting
}

/** 手の吹き出しで選べるか。両手は 13 鍵で選べない */
export function handIsSelectable(hands: PlayHands, allowsBoth: boolean): boolean {
  return hands !== 'both' || allowsBoth
}

/** 鍵盤数の吹き出しの選択肢 */
export const KEY_LAYOUT_OPTIONS: readonly { value: 'keys13' | 'keys25'; label: string }[] = [
  { value: 'keys13', label: '13 鍵' },
  { value: 'keys25', label: '25 鍵' },
]

/** 今の鍵盤の範囲を選択肢の値に当てはめる */
export function keyLayoutOf(range: KeyRange): 'keys13' | 'keys25' {
  return keyCount(range) <= keyCount(KEYS13) ? 'keys13' : 'keys25'
}

/** 鍵盤数ボタンの表示（自動なら決めた結果） */
export function keyLayoutLabel(range: KeyRange): string {
  return KEY_LAYOUT_OPTIONS.find((o) => o.value === keyLayoutOf(range))!.label
}

/** 進み具合の割合（0〜1）。曲が空なら 0 */
export function progressFraction(done: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(done)) return 0
  return Math.min(Math.max(done / total, 0), 1)
}

/** 進み具合の文言 「24 / 96」 */
export function progressText(done: number, total: number): string {
  return `${done} / ${total}`
}

/** 幅 ≥ 高さなら横画面 */
export function isLandscape(width: number, height: number): boolean {
  return width >= height
}

/** m:ss。有限でない値と負の値は 0:00 にする */
export function timeText(seconds: number): string {
  const rounded = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
  const total = Math.min(rounded, 2147483647)
  const s = total % 60
  return `${Math.floor(total / 60)}:${s < 10 ? '0' : ''}${s}`
}

/** 演奏の始まりを知らせるか。まだ知らせていなくて、正しい音でステップを進めたとき */
export function shouldReportStart(alreadyReported: boolean, advancedSteps: number): boolean {
  return !alreadyReported && advancedSteps > 0
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/** 表示に使う値が同じか（毎フレームの snapshot は新しい object なので、中身で比べる） */
export function snapshotsEqual(a: GuideSnapshot | null, b: GuideSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.stepIndex === b.stepIndex &&
    a.stepCount === b.stepCount &&
    a.collectedMask === b.collectedMask &&
    a.collectedLeftMask === b.collectedLeftMask &&
    a.wrongCount === b.wrongCount &&
    a.isFinished === b.isFinished &&
    a.isComplete === b.isComplete &&
    a.isPaused === b.isPaused &&
    a.hands === b.hands &&
    a.autoplay === b.autoplay &&
    a.advancedSteps === b.advancedSteps &&
    // 経過時間は秒単位で見せる
    Math.floor(a.elapsed) === Math.floor(b.elapsed) &&
    sameSet(a.wrongHeldNotes, b.wrongHeldNotes) &&
    sameSet(a.wrongHeldLeft, b.wrongHeldLeft) &&
    sameSet(a.wrongHeldRight, b.wrongHeldRight)
  )
}
