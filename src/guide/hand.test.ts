import { describe, it, expect } from 'vitest'
import { PLAY_HANDS, handFor, type HandSplit } from './hand'

describe('handFor', () => {
  it('分けないときは全部右手', () => {
    const split: HandSplit = { kind: 'none' }
    expect(handFor(split, 36)).toBe('right')
    expect(handFor(split, 72)).toBe('right')
  })

  it('音の高さで分けるとき境目未満が左手', () => {
    const split: HandSplit = { kind: 'byNote', lowestRight: 60 }
    expect(handFor(split, 59)).toBe('left')
    expect(handFor(split, 0)).toBe('left')
  })

  it('音の高さで分けるとき境目以上が右手', () => {
    const split: HandSplit = { kind: 'byNote', lowestRight: 60 }
    expect(handFor(split, 60)).toBe('right')
    expect(handFor(split, 127)).toBe('right')
  })

  it('手の選択は左手・両手・右手の順に並ぶ', () => {
    expect(PLAY_HANDS).toEqual(['leftOnly', 'both', 'rightOnly'])
  })
})
