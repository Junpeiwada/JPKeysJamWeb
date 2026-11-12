import { describe, expect, it } from 'vitest'
import { KEYS13, KEYS25 } from '../guide/keyRange'
import type { GuideSnapshot } from '../guide/guideSession'
import {
  displayedHands,
  guideNotesForSounding,
  keyboardHeight,
  logoGlyphHeight,
  stepAtFraction,
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

describe('iOS の演奏画面の寸法', () => {
  it('横向きの鍵盤の高さは白鍵の縦横比 4 と画面の高さの 36% の小さい方で、108 を下回らない', () => {
    // iPhone 横（852×393、余白 16 ずつ）・25 鍵（白鍵 15）
    expect(keyboardHeight(852, 393, true, 820, 15)).toBeCloseTo(393 * 0.36)
    // 幅が狭いと白鍵の縦横比で決まる
    expect(keyboardHeight(600, 800, true, 300, 15)).toBe(108)
    expect(keyboardHeight(2000, 900, true, 600, 15)).toBeCloseTo(160)
  })

  it('縦向きの鍵盤の高さは画面の幅の 56% と高さの 33% の小さい方', () => {
    expect(keyboardHeight(393, 852, false, 361, 8)).toBeCloseTo(393 * 0.56)
    expect(keyboardHeight(800, 900, false, 768, 8)).toBeCloseTo(900 * 0.33)
  })

  it('バーの割合から最後のステップまでのステップを返す', () => {
    expect(stepAtFraction(0, 10)).toBe(0)
    expect(stepAtFraction(0.55, 10)).toBe(5)
    expect(stepAtFraction(1, 10)).toBe(9)
    expect(stepAtFraction(-1, 10)).toBe(0)
    expect(stepAtFraction(0.5, 0)).toBe(0)
    expect(stepAtFraction(Number.NaN, 10)).toBe(0)
  })

  it('ロゴはすき間が足りないときは出さない', () => {
    expect(logoGlyphHeight(20, 852)).toBeNull()
    expect(logoGlyphHeight(41, 852)).toBeCloseTo(26.25)
    expect(logoGlyphHeight(200, 852)).toBe(32)
  })

  it('自動演奏中は鳴っている音を手の区域の鍵に振り替える', () => {
    const range = { lowest: 48, highest: 72 }
    // 右手 64 はそのまま、85（C#6）は右手の区域（60〜72）の C# の 61、左手 36（C2）は左手の区域（48〜59）の 48
    expect([...guideNotesForSounding({ right: [64, 85], left: [36] }, 'both', range)].sort((a, b) => a - b)).toEqual([48, 61, 64])
  })
})
