import { describe, it, expect } from 'vitest'
import { PlayHistory, HISTORY_KEY, HISTORY_LIMIT, type StorageLike } from './history'

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('x')
  },
  setItem: () => {
    throw new Error('x')
  },
  removeItem: () => {
    throw new Error('x')
  },
}

function clock() {
  let t = 1000
  return () => t++
}

describe('PlayHistory', () => {
  it('新しいものが先頭、保存して読み直せる', () => {
    const s = fakeStorage()
    const h = new PlayHistory(s, clock())
    h.record('a', 'a1')
    h.record('b', 'b1')
    expect(h.all().map((r) => r.songID)).toEqual(['b', 'a'])
    expect(h.all()[0].playedAt).toBe(1001)
    const again = new PlayHistory(s)
    expect(again.all()).toEqual(h.all())
  })

  it('200 件を超えたら古いものを捨てる', () => {
    const h = new PlayHistory(fakeStorage(), clock())
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h.record(`s${i}`, 'x')
    expect(h.all().length).toBe(HISTORY_LIMIT)
    expect(h.all()[0].songID).toBe(`s${HISTORY_LIMIT + 4}`)
    expect(h.all().at(-1)?.songID).toBe('s5')
  })

  it('保存が上限を超えていても読み込みで切る', () => {
    const s = fakeStorage()
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `${i}`, songID: `s${i}`, arrangementID: 'x', playedAt: i }))
    s.map.set(HISTORY_KEY, JSON.stringify(many))
    expect(new PlayHistory(s).all().length).toBe(HISTORY_LIMIT)
  })

  it('remove と clearAll', () => {
    const h = new PlayHistory(fakeStorage(), clock())
    const r = h.record('a', 'x')
    h.record('b', 'x')
    h.remove(r.id)
    h.remove('なし')
    expect(h.all().map((x) => x.songID)).toEqual(['b'])
    h.clearAll()
    expect(h.all()).toEqual([])
  })

  it('recentSongs は曲ごとに最新 1 件、条件で飛ばして limit まで埋める', () => {
    const h = new PlayHistory(fakeStorage(), clock())
    for (const s of ['a', 'b', 'a', 'c', 'd']) h.record(s, 'x')
    expect(h.recentSongs(3).map((r) => r.songID)).toEqual(['d', 'c', 'a'])
    expect(h.recentSongs(2, (id) => id !== 'd').map((r) => r.songID)).toEqual(['c', 'a'])
    expect(h.recentSongs(0)).toEqual([])
    expect(h.recentSongs(10).length).toBe(4)
  })

  it('壊れた中身は空として扱う', () => {
    const s = fakeStorage()
    s.map.set(HISTORY_KEY, '{壊れ')
    expect(new PlayHistory(s).all()).toEqual([])
    s.map.set(HISTORY_KEY, JSON.stringify([{ id: 1 }, { id: 'a', songID: 's', arrangementID: 'x', playedAt: 5 }]))
    expect(new PlayHistory(s).all().length).toBe(1)
  })

  it('保存先が無い・例外を投げても動く', () => {
    for (const st of [null, throwing]) {
      const h = new PlayHistory(st, clock())
      h.record('a', 'x')
      h.remove(h.all()[0].id)
      h.clearAll()
      expect(h.all()).toEqual([])
    }
  })
})
