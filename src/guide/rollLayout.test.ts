// 手本: Tests/GuideRollTests.swift（GuideRollLayout のケース。13 鍵 × 2 台に固有のものは無い）
import { describe, expect, it } from 'vitest'
import { KEYS13, KEYS25, whiteKeyCount } from './keyRange'
import {
  FADE_DURATION,
  KEYBOARD_INSET as inset,
  NEXT_OPACITY,
  OTHER_OPACITY,
  PLAYED_OPACITY,
  POINTS_PER_SECOND,
  MIN_BAR_LENGTH,
  REACH_TOLERANCE,
  approach,
  barOpacity,
  barStepsAhead,
  blend,
  boundaryX,
  columns,
  displayedStepsAhead,
  draggedPosition,
  fadeProgress,
  fades,
  firstVisibleIndex,
  isCollected,
  judgeY,
  keyRects,
  keyboardGeometry,
  isBlack,
  labelOpacity,
  lastVisibleTime,
  nearestStep,
  resolve,
  resolveInColumns,
  resolveInKeyRange,
  showsLabel,
  showsLabels,
  vertical,
  zones,
  type Column,
  type Progress,
} from './rollLayout'

function col(key: number, map: ReadonlyMap<number, Column>): Column {
  const c = map.get(key)
  if (!c) throw new Error(`列が無い: ${key}`)
  return c
}

describe('列の配置', () => {
  it('白鍵は等間隔で黒鍵は白鍵の境目に出る', () => {
    // 13 鍵: C4〜C5（白鍵 8）、幅 800、白鍵幅 100
    const cols = columns(60, 8, 800)
    expect(col(60, cols).centerX).toBeCloseTo(inset + 50, 9)
    expect(col(62, cols).centerX).toBeCloseTo(inset + 150, 9)
    expect(col(61, cols).centerX).toBeCloseTo(inset + 100, 9)
    expect(col(72, cols).centerX).toBeCloseTo(inset + 750, 9)
    expect(col(60, cols).width).toBeCloseTo(98.5, 9)
    expect(col(61, cols).width).toBeCloseTo(60, 9)
    expect(cols.size).toBe(13)
  })

  it('細い棒には音名を出さない', () => {
    expect(showsLabel(24)).toBe(true)
    expect(showsLabel(23.9)).toBe(false)
  })

  it('黒鍵の棒に音名が収まらないなら白鍵の棒にも出さない', () => {
    const white: Column = { centerX: 0, width: 30 }
    expect(showsLabels(new Map([[60, white], [61, { centerX: 0, width: 24 }]]))).toBe(true)
    expect(showsLabels(new Map([[60, white], [61, { centerX: 0, width: 18 }]]))).toBe(false)
    expect(showsLabels(new Map())).toBe(false)
  })

  it('列の音の集合は鍵の並びの全ノートと一致する', () => {
    for (const range of [KEYS13, KEYS25]) {
      const cols = columns(range.lowest, whiteKeyCount(range), 606)
      const geometry = keyboardGeometry(range.lowest, whiteKeyCount(range))
      expect(new Set(cols.keys())).toEqual(new Set(geometry.allNotes))
    }
  })

  it('鍵の並びは 13 鍵で白鍵 8・黒鍵 5、25 鍵で白鍵 15・黒鍵 10', () => {
    const g13 = keyboardGeometry(60, 8)
    expect(g13.whiteNotes).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
    expect(g13.blackKeys.map((b) => b.note)).toEqual([61, 63, 66, 68, 70])
    expect(g13.allNotes.size).toBe(13)
    const g25 = keyboardGeometry(48, 15)
    expect(g25.allNotes.size).toBe(25)
    // 黒鍵から始まるときは次の白鍵から数える。白鍵 0 なら空
    expect(keyboardGeometry(61, 1).whiteNotes).toEqual([62])
    expect(keyboardGeometry(60, 0).allNotes.size).toBe(0)
  })

  it('鍵盤の端: 黒鍵始まりと 127 付近', () => {
    // 61（C#）始まりは D から数える。右端の白鍵の右には黒鍵を置かない
    const low = keyboardGeometry(61, 3)
    expect(low.whiteNotes).toEqual([62, 64, 65])
    expect(low.blackKeys).toEqual([{ note: 63, whiteIndex: 0 }])
    // 127 を超えては置かない
    const high = keyboardGeometry(125, 5)
    expect(high.whiteNotes).toEqual([125, 127])
    expect(high.blackKeys).toEqual([{ note: 126, whiteIndex: 0 }])
    expect(Math.max(...high.allNotes)).toBe(127)
  })

  it('isBlack は負の音でも音名で決まる', () => {
    expect(isBlack(-11)).toBe(true) // -11 は音名 1（C#）
    expect(isBlack(-12)).toBe(false)
    expect(isBlack(61)).toBe(true)
    expect(isBlack(60)).toBe(false)
  })

  it('鍵の位置は白鍵が等間隔で黒鍵は境目を中心にする', () => {
    const rects = keyRects(keyboardGeometry(60, 8), 800)
    const byNote = new Map(rects.map((r) => [r.note, r]))
    expect(byNote.get(62)?.x).toBeCloseTo(100, 9)
    expect(byNote.get(62)?.width).toBeCloseTo(100, 9)
    expect(byNote.get(61)?.black).toBe(true)
    expect((byNote.get(61)?.x ?? 0) + (byNote.get(61)?.width ?? 0) / 2).toBeCloseTo(100, 9)
    expect(byNote.get(61)?.width).toBeCloseTo(60, 9)
    expect(keyRects(keyboardGeometry(60, 0), 800)).toEqual([])
  })
})

describe('resolve', () => {
  it('範囲内の音はそのまま、はみ出す音は同じ音名で一番近い鍵に振り替える', () => {
    const range = KEYS25 // C3〜C5
    const cols = columns(range.lowest, whiteKeyCount(range), 300)
    expect(resolveInKeyRange(60, cols, range)).toBe(60)
    expect(resolveInKeyRange(84, cols, range)).toBe(72) // C6 は C5
    expect(resolveInKeyRange(36, cols, range)).toBe(48) // C2 は C3
    expect(resolveInKeyRange(87, cols, range)).toBe(75 - 12) // D#6 は D#4(63)
    const small = KEYS13
    const smallCols = columns(small.lowest, whiteKeyCount(small), 206)
    expect(resolveInKeyRange(52, smallCols, small)).toBe(64) // E3 は E4
  })

  it('区域を渡した resolve は区域の中で一番近い同じ音名を選ぶ', () => {
    const cols = columns(KEYS25.lowest, whiteKeyCount(KEYS25), 300)
    expect(resolveInColumns(60, cols, 48, 59)).toBe(48)
    expect(resolveInColumns(48, cols, 60, 72)).toBe(60)
    expect(resolveInColumns(64, cols, 60, 72)).toBe(64)
    expect(resolveInColumns(84, cols, 60, 72)).toBe(72)
    expect(resolveInColumns(89, cols, 60, 72)).toBe(65)
  })

  it('区域の端が黒鍵のとき', () => {
    const cols = columns(60, 8, 800)
    expect(resolveInColumns(61, cols, 61, 66)).toBe(61)
    expect(resolveInColumns(60, cols, 61, 66)).toBeNull()
  })

  it('区域に同じ音名の列が無ければ null', () => {
    const cols = columns(48, 15, 300)
    expect(resolveInColumns(64, cols, 60, 62)).toBeNull()
    expect(resolveInColumns(60, cols, 62, 60)).toBeNull()
  })

  it('区域の resolve は同じ距離なら低い方を選ぶ', () => {
    const c: Column = { centerX: 0, width: 1 }
    const cols = new Map([[48, c], [72, c]])
    expect(resolveInColumns(60, cols, 48, 72)).toBe(48)
  })

  it('列を使わない resolve は区域内の鍵がすべてある前提で振り替える', () => {
    expect(resolve(60, 48, 72)).toBe(60)
    expect(resolve(84, 60, 72)).toBe(72)
    expect(resolve(89, 60, 72)).toBe(65)
    expect(resolve(60, 62, 60)).toBeNull()
    // 区域が 1 オクターブ未満で同じ音名が無い
    expect(resolve(64, 60, 62)).toBeNull()
  })
})

describe('縦の位置', () => {
  it('time が position と同じなら棒の下端が判定線に接する', () => {
    const v = vertical(5, 6, 5, 200)
    expect(v.bottom).toBeCloseTo(judgeY(200), 9)
    expect(v.bottom - v.top).toBeCloseTo(POINTS_PER_SECOND, 9)
  })

  it('先のステップは上、過ぎたステップは下になる', () => {
    const ahead = vertical(6, 7, 5, 200)
    const now = vertical(5, 6, 5, 200)
    const past = vertical(4, 5, 5, 200)
    expect(ahead.bottom).toBeLessThan(now.bottom)
    expect(past.bottom).toBeGreaterThan(now.bottom)
  })

  it('短い音でも最小の長さを持つ', () => {
    const v = vertical(1, 1, 1, 200)
    expect(v.bottom - v.top).toBeCloseTo(MIN_BAR_LENGTH, 9)
  })

  it('見える先頭の添字は判定線の下に抜けたステップを飛ばす', () => {
    const times = [0, 1, 2, 3, 4]
    expect(firstVisibleIndex(times, 0, 3, 200)).toBe(3)
    expect(firstVisibleIndex(times, 0, 0, 200)).toBe(0)
    expect(firstVisibleIndex(times, 0, 10, 200)).toBe(5)
    expect(firstVisibleIndex([], 0, 0, 200)).toBe(0)
  })

  it('長い音は time が少し過ぎても描画対象に残る', () => {
    const times = [0, 2, 4]
    expect(firstVisibleIndex(times, 3, 3, 200)).toBeLessThanOrEqual(1)
    const v = vertical(2, 5, 3, 200)
    expect(v.top).toBeLessThan(200)
    expect(firstVisibleIndex(times, 0, 3, 200)).toBe(2)
  })

  it('画面の上に外れる時刻', () => {
    const last = lastVisibleTime(2, 200)
    const v = vertical(last, last + 1, 2, 200)
    expect(v.bottom).toBeCloseTo(0, 9)
  })
})

describe('両手の区域と境目', () => {
  it('両手の境目の x は lowestRight の白鍵の左端', () => {
    const whites = keyboardGeometry(60, 8).whiteNotes
    expect(boundaryX(62, whites, 800)).toBeCloseTo(inset + 100, 9)
    expect(boundaryX(64, whites, 800)).toBeCloseTo(inset + 200, 9) // E4 は 3 本目
    expect(boundaryX(66, whites, 800)).toBeCloseTo(inset + 400, 9) // 黒鍵 F#4 → G4
    expect(boundaryX(60, whites, 800)).toBeNull()
    expect(boundaryX(50, whites, 800)).toBeNull()
    expect(boundaryX(80, whites, 800)).toBeNull()
    expect(boundaryX(60, keyboardGeometry(60, 0).whiteNotes, 800)).toBeNull()
  })

  it('25 鍵で lowestRight 60 の境目は白鍵の境目の線と一致する', () => {
    const whites = keyboardGeometry(KEYS25.lowest, whiteKeyCount(KEYS25)).whiteNotes
    const x = boundaryX(60, whites, 300) // 白鍵幅 20
    expect(x).not.toBeNull()
    expect(x as number).toBeCloseTo(inset + 20 * 7, 9)
  })

  it('手ごとの区域', () => {
    const whole = { lowest: 48, highest: 72 }
    expect(zones({ kind: 'rightOnly' }, 48, 72).right).toEqual(whole)
    expect(zones({ kind: 'rightOnly' }, 48, 72).left).toBeNull()
    expect(zones({ kind: 'leftOnly' }, 48, 72).right).toBeNull()
    expect(zones({ kind: 'leftOnly' }, 48, 72).left).toEqual(whole)
    const split = zones({ kind: 'split', lowestRight: 60 }, 48, 72)
    expect(split.right).toEqual({ lowest: 60, highest: 72 })
    expect(split.left).toEqual({ lowest: 48, highest: 59 })
    const atLowest = zones({ kind: 'split', lowestRight: 48 }, 48, 72)
    expect(atLowest.right).toEqual(whole)
    expect(atLowest.left).toBeNull()
    const aboveHighest = zones({ kind: 'split', lowestRight: 73 }, 48, 72)
    expect(aboveHighest.right).toBeNull()
    expect(aboveHighest.left).toEqual(whole)
    const zero = zones({ kind: 'split', lowestRight: 0 }, 48, 72)
    expect(zero.right).toEqual(whole)
    expect(zero.left).toBeNull()
  })
})

describe('棒の濃さ', () => {
  it('棒は次のステップが一番濃く済んだ棒が一番暗い', () => {
    expect(barOpacity(0)).toBe(NEXT_OPACITY)
    expect(NEXT_OPACITY).toBeGreaterThan(OTHER_OPACITY)
    expect(OTHER_OPACITY).toBeGreaterThan(PLAYED_OPACITY)
    for (const n of [1, 2, 5, 10]) expect(barOpacity(n)).toBe(OTHER_OPACITY)
    for (const n of [-3, -1]) expect(barOpacity(n)).toBe(PLAYED_OPACITY)
  })

  it('濃さのフェードは 1 ステップ進んだときだけで時間が過ぎたら今の濃さ', () => {
    const state = (index: number, mask = 0, left = 0): Progress => ({
      stepIndex: index,
      collectedMask: mask,
      collectedLeftMask: left,
    })
    expect(fades(state(3), state(4))).toBe(true)
    expect(fades(state(3), state(3, 0b1))).toBe(true)
    expect(fades(state(3, 0b1), state(3, 0b1, 0b100))).toBe(true)
    expect(fades(state(3, 0b1), state(3, 0b1))).toBe(false)
    expect(fades(state(3), state(6))).toBe(false)
    expect(fades(state(4), state(3))).toBe(false)
    expect(fades(state(10), state(0))).toBe(false)

    expect(fadeProgress(null)).toBe(1)
    expect(fadeProgress(0)).toBe(0)
    expect(fadeProgress(FADE_DURATION / 2)).toBeCloseTo(0.5, 9)
    expect(fadeProgress(FADE_DURATION * 3)).toBe(1)

    const next = NEXT_OPACITY
    const played = PLAYED_OPACITY
    expect(blend(next, played, 0)).toBe(next)
    expect(blend(next, played, 1)).toBeCloseTo(played, 9)
    expect(blend(next, played, 0.5)).toBeCloseTo((next + played) / 2, 9)
    expect(labelOpacity(-1)).toBeLessThan(labelOpacity(0))
  })

  it('次のステップの棒は判定線に届いた瞬間に明るくなる', () => {
    expect(approach(10, 9.9)).toBe(0)
    expect(approach(10, 10 - REACH_TOLERANCE - 0.001)).toBe(0)
    expect(barOpacity(0, 0)).toBe(OTHER_OPACITY)
    expect(approach(10, 10)).toBe(1)
    expect(approach(10, 9.999)).toBe(1)
    expect(barOpacity(2, 0.5)).toBe(OTHER_OPACITY)
    expect(barOpacity(-1, 0.5)).toBe(PLAYED_OPACITY)
  })

  it('今のステップでも押した音名の棒は済んだ棒として描く', () => {
    expect(barStepsAhead(0, true)).toBe(-1)
    expect(barStepsAhead(0, false)).toBe(0)
    expect(barStepsAhead(2, true)).toBe(2)
    expect(barStepsAhead(-1, false)).toBe(-1)

    // C（0）と E（4）の右手、G（7）の左手を押した
    const state: Progress = { stepIndex: 0, collectedMask: 0b1_0001, collectedLeftMask: 1 << 7 }
    expect(isCollected(state, 60, false)).toBe(true)
    expect(isCollected(state, 76, false)).toBe(true) // オクターブ違いも同じ音名
    expect(isCollected(state, 67, false)).toBe(false)
    expect(isCollected(state, 55, true)).toBe(true)
    expect(isCollected(state, 48, true)).toBe(false)
  })

  it('自動演奏中は済んだ棒も判定線に届いた棒と同じ段階で描く', () => {
    expect(displayedStepsAhead(-2, true)).toBe(0)
    expect(displayedStepsAhead(-2, false)).toBe(-2)
    expect(displayedStepsAhead(3, true)).toBe(3)
  })
})

describe('ドラッグ', () => {
  it('移る先は一番近いステップで同じ距離なら前', () => {
    const times = [0.5, 1.0, 1.5]
    expect(nearestStep(0.0, times)).toBe(0)
    expect(nearestStep(0.8, times)).toBe(1)
    expect(nearestStep(0.75, times)).toBe(0)
    expect(nearestStep(1.5, times)).toBe(2)
    expect(nearestStep(9.0, times)).toBe(2)
    expect(nearestStep(1.0, [])).toBe(0)
  })

  it('ロールを下へドラッグすると進み最初と最後のステップの間に収まる', () => {
    const times = [0.5, 1.0, 3.0]
    const pps = POINTS_PER_SECOND
    expect(draggedPosition(1.0, pps, times)).toBeCloseTo(2.0, 9)
    expect(draggedPosition(1.0, -pps, times)).toBeCloseTo(0.5, 9)
    expect(draggedPosition(1.0, pps * 10, times)).toBeCloseTo(3.0, 9)
    expect(draggedPosition(1.0, pps, [])).toBe(1.0)
  })
})
