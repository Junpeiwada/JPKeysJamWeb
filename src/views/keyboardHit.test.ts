import { describe, expect, it } from 'vitest'
import { keyboardGeometry } from '../guide/rollLayout'
import { hitNote } from './keyboardHit'

// C4 から白鍵 8 つ（C4〜C5）。幅 800・高さ 100 なら白鍵幅 100、黒鍵幅 60・高さ 62
const geometry = keyboardGeometry(60, 8)

describe('hitNote', () => {
  it('白鍵の中ほどはその白鍵', () => {
    expect(hitNote(geometry, 50, 90, 800, 100)).toBe(60)
    expect(hitNote(geometry, 250, 10, 800, 100)).toBe(64)
  })

  it('黒鍵の上部は黒鍵を優先する', () => {
    expect(hitNote(geometry, 100, 30, 800, 100)).toBe(61)
    expect(hitNote(geometry, 75, 30, 800, 100)).toBe(61)
  })

  it('黒鍵の下（高さの 62% 以降）は白鍵', () => {
    expect(hitNote(geometry, 95, 80, 800, 100)).toBe(60)
    expect(hitNote(geometry, 105, 80, 800, 100)).toBe(62)
  })

  it('黒鍵の無い境目（E と F の間）は白鍵', () => {
    expect(hitNote(geometry, 300, 30, 800, 100)).toBe(65)
  })

  it('外へはみ出したら端の鍵', () => {
    expect(hitNote(geometry, -20, 50, 800, 100)).toBe(60)
    expect(hitNote(geometry, 900, 50, 800, 100)).toBe(72)
  })

  it('サイズ 0 は null', () => {
    expect(hitNote(geometry, 10, 10, 0, 100)).toBeNull()
    expect(hitNote(geometry, 10, 10, 800, 0)).toBeNull()
  })
})
