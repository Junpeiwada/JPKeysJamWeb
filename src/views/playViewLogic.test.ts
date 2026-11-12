import { describe, expect, it } from 'vitest'
import { KEYS13, KEYS25 } from '../guide/keyRange'
import type { GuideSnapshot } from '../guide/guideSession'
import {
  displayedHands,
  guideNotes,
  guideNotesForStep,
  handIsSelectable,
  handsName,
  isLandscape,
  keyLayoutLabel,
  keyboardAllowsBothHands,
  progressFraction,
  progressText,
  rollHands,
  shouldReportStart,
  snapshotsEqual,
  timeText,
} from './playViewLogic'

const only = (...pcs: number[]) => new Set(pcs)

describe('guideNotes', () => {
  it('25 鍵の両手は右手が境目以上、左手が境目未満の区域に 1 つずつ', () => {
    expect(guideNotes([60], only(0), KEYS25, 'right', true)).toEqual(new Set([60]))
    expect(guideNotes([48], only(0), KEYS25, 'left', true)).toEqual(new Set([48]))
    // 右手の C3 は右手の区域（C4〜C5）の近い C、左手の C4 は左手の区域（C3〜B3）の C
    expect(guideNotes([48], only(0), KEYS25, 'right', true)).toEqual(new Set([60]))
    expect(guideNotes([60], only(0), KEYS25, 'left', true)).toEqual(new Set([48]))
  })

  it('範囲内の音はその高さの鍵だけ光る', () => {
    expect(guideNotes([60], only(0), KEYS13, 'right', false)).toEqual(new Set([60]))
    expect(guideNotes([72], only(0), KEYS13, 'right', false)).toEqual(new Set([72]))
    expect(guideNotes([60], only(0), KEYS25, 'right', false)).toEqual(new Set([60]))
  })

  it('はみ出す音は同じ音名で一番近い鍵だけ光る', () => {
    // 13 鍵（C4〜C5）: C6 → C5、G3 → G4、B3 → B4
    expect(guideNotes([84], only(0), KEYS13, 'right', false)).toEqual(new Set([72]))
    expect(guideNotes([55], only(7), KEYS13, 'right', false)).toEqual(new Set([67]))
    expect(guideNotes([59], only(11), KEYS13, 'right', false)).toEqual(new Set([71]))
  })

  it('そろった音名は光らせず、オクターブ重ねは両方光る', () => {
    // C4・E4・G4 のうち E がそろった
    expect(guideNotes([60, 64, 67], only(0, 7), KEYS13, 'right', false)).toEqual(new Set([60, 67]))
    // C4 と C5 の重ね
    expect(guideNotes([60, 72], only(0), KEYS13, 'right', false)).toEqual(new Set([60, 72]))
  })
})

describe('guideNotesForStep', () => {
  const step = {
    time: 0,
    endTime: 1,
    notes: [60, 64],
    pitchClasses: new Set([0, 4]),
    leftNotes: [48],
    leftPitchClasses: new Set([0]),
    noteEnds: [1, 1],
    leftNoteEnds: [1],
  }

  it('両手は右手と左手の鍵を足す。そろった音名は外す', () => {
    const snapshot = { collectedPitchClasses: new Set([4]), collectedLeftPitchClasses: new Set<number>(), hands: 'both' as const }
    expect(guideNotesForStep(step, snapshot, KEYS25)).toEqual(new Set([60, 48]))
  })

  it('ステップが無ければ空', () => {
    const snapshot = { collectedPitchClasses: new Set<number>(), collectedLeftPitchClasses: new Set<number>(), hands: 'rightOnly' as const }
    expect(guideNotesForStep(undefined, snapshot, KEYS25)).toEqual(new Set())
  })
})

describe('手と鍵盤数', () => {
  it('ロールを分けるのは判定中の列が両手のときだけ', () => {
    expect(rollHands('both')).toEqual({ kind: 'split', lowestRight: 60 })
    expect(rollHands('rightOnly')).toEqual({ kind: 'rightOnly' })
    expect(rollHands('leftOnly')).toEqual({ kind: 'rightOnly' })
  })

  it('両手にできる鍵盤は 25 鍵', () => {
    expect(keyboardAllowsBothHands(KEYS13)).toBe(false)
    expect(keyboardAllowsBothHands(KEYS25)).toBe(true)
  })

  it('手の表示名は左手・両手・右手', () => {
    expect((['leftOnly', 'both', 'rightOnly'] as const).map(handsName)).toEqual(['左手', '両手', '右手'])
  })

  it('ボタンの手: 左手の無い曲と 13 鍵の両手は右手', () => {
    expect(displayedHands('both', false, true)).toBe('rightOnly')
    expect(displayedHands('leftOnly', false, true)).toBe('rightOnly')
    expect(displayedHands('both', true, false)).toBe('rightOnly')
    expect(displayedHands('both', true, true)).toBe('both')
    expect(displayedHands('leftOnly', true, false)).toBe('leftOnly')
  })

  it('13 鍵では両手を選べない', () => {
    expect(handIsSelectable('both', false)).toBe(false)
    expect(handIsSelectable('both', true)).toBe(true)
    expect(handIsSelectable('leftOnly', false)).toBe(true)
    expect(handIsSelectable('rightOnly', false)).toBe(true)
  })

  it('鍵盤数ボタンは今の鍵盤を出す', () => {
    expect(keyLayoutLabel(KEYS13)).toBe('13 鍵')
    expect(keyLayoutLabel(KEYS25)).toBe('25 鍵')
  })
})

describe('進み具合・画面', () => {
  it('割合と文言', () => {
    expect(progressFraction(24, 96)).toBe(0.25)
    expect(progressFraction(5, 0)).toBe(0)
    expect(progressFraction(200, 100)).toBe(1)
    expect(progressText(24, 96)).toBe('24 / 96')
  })

  it('縦横は幅と高さの比', () => {
    expect(isLandscape(800, 400)).toBe(true)
    expect(isLandscape(400, 400)).toBe(true)
    expect(isLandscape(400, 800)).toBe(false)
  })

  it('演奏の始まりはステップを進めたとき一度だけ知らせる', () => {
    expect(shouldReportStart(false, 0)).toBe(false)
    expect(shouldReportStart(false, 1)).toBe(true)
    expect(shouldReportStart(true, 1)).toBe(false)
  })
})

describe('timeText', () => {
  it('分と秒の表示', () => {
    expect(timeText(0)).toBe('0:00')
    expect(timeText(59.4)).toBe('0:59')
    expect(timeText(59.6)).toBe('1:00')
    expect(timeText(125)).toBe('2:05')
  })

  it('負の値と有限でない値は 0:00 にする', () => {
    expect(timeText(-5)).toBe('0:00')
    expect(timeText(NaN)).toBe('0:00')
    expect(timeText(Infinity)).toBe('0:00')
    expect(timeText(-Infinity)).toBe('0:00')
  })
})

describe('snapshotsEqual', () => {
  const base: GuideSnapshot = {
    stepIndex: 1,
    stepCount: 10,
    collectedMask: 0,
    collectedLeftMask: 0,
    collectedPitchClasses: new Set(),
    collectedLeftPitchClasses: new Set(),
    wrongHeldLeft: new Set(),
    wrongHeldRight: new Set(),
    wrongHeldNotes: new Set(),
    wrongCount: 0,
    isFinished: false,
    elapsed: 3.1,
    isComplete: false,
    isPaused: false,
    hands: 'rightOnly',
    autoplay: 'off',
    advancedSteps: 1,
  }

  it('中身が同じなら同じ。同じ秒の経過時間の違いは無視する', () => {
    expect(snapshotsEqual(base, { ...base, elapsed: 3.9 })).toBe(true)
    expect(snapshotsEqual(null, null)).toBe(true)
  })

  it('ステップ・違う鍵・秒が変われば違う', () => {
    expect(snapshotsEqual(base, { ...base, stepIndex: 2 })).toBe(false)
    expect(snapshotsEqual(base, { ...base, wrongHeldNotes: new Set([61]) })).toBe(false)
    expect(snapshotsEqual(base, { ...base, elapsed: 4.0 })).toBe(false)
    expect(snapshotsEqual(base, null)).toBe(false)
  })
})
