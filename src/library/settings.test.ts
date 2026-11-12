import { describe, it, expect } from 'vitest'
import { AppSettings, SETTINGS_KEY } from './settings'
import type { StorageLike } from './history'

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('AppSettings', () => {
  it('既定値', () => {
    const s = new AppSettings(fakeStorage())
    expect(s.keyRange).toBe('auto')
    expect(s.hands).toBe('rightOnly')
    expect(s.oneNote).toBe(false)
    expect(s.arrangementFor('x')).toBeUndefined()
  })

  it('変更は保存され、読み直せる', () => {
    const st = fakeStorage()
    const s = new AppSettings(st)
    s.keyRange = 'keys25'
    s.hands = 'both'
    s.oneNote = true
    s.setArrangement('song1', 'arr2')
    const again = new AppSettings(st)
    expect(again.keyRange).toBe('keys25')
    expect(again.hands).toBe('both')
    expect(again.oneNote).toBe(true)
    expect(again.arrangementFor('song1')).toBe('arr2')
  })

  it('知らない値は既定値に戻し、読める項目は残す', () => {
    const st = fakeStorage()
    st.map.set(
      SETTINGS_KEY,
      JSON.stringify({ keyRange: 'keys99', hands: 'both', oneNote: 'yes', arrangements: { a: 'x', b: 3 } }),
    )
    const s = new AppSettings(st)
    expect(s.keyRange).toBe('auto')
    expect(s.hands).toBe('both')
    expect(s.oneNote).toBe(false)
    expect(s.arrangementFor('a')).toBe('x')
    expect(s.arrangementFor('b')).toBeUndefined()
  })

  it('壊れた JSON・保存先なし・例外でも既定値で動く', () => {
    const st = fakeStorage()
    st.map.set(SETTINGS_KEY, '{壊れ')
    expect(new AppSettings(st).hands).toBe('rightOnly')
    const bad: StorageLike = {
      getItem: () => {
        throw new Error('x')
      },
      setItem: () => {
        throw new Error('x')
      },
      removeItem: () => {},
    }
    for (const store of [null, bad]) {
      const s = new AppSettings(store)
      s.oneNote = true
      expect(s.oneNote).toBe(true)
    }
  })

  it('購読と解除', () => {
    const s = new AppSettings(fakeStorage())
    let n = 0
    const off = s.subscribe(() => n++)
    s.hands = 'leftOnly'
    s.setArrangement('a', 'b')
    off()
    s.oneNote = true
    expect(n).toBe(2)
  })
})
