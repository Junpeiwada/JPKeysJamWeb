import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// コミット済みの public/songs を検査する（catalog.csv は private で CI から読めないため、songs.json だけで確かめる）
const dir = new URL('../public/songs/', import.meta.url)
type Song = { id: string; access: string; source: string; arrangements: { file: string }[] }
const songs: Song[] = JSON.parse(fs.readFileSync(new URL('songs.json', dir), 'utf-8'))
const mids = (sub: string) =>
  fs.existsSync(new URL(sub, dir)) ? fs.readdirSync(new URL(sub, dir)).filter((f) => f.endsWith('.mid')).sort() : []

describe('public/songs', () => {
  it('全曲が free・bundled', () => {
    expect(songs.length).toBeGreaterThan(0)
    for (const s of songs) {
      expect(s.access, s.id).toBe('free')
      expect(s.source, s.id).toBe('bundled')
    }
  })

  it('id と file の形が正しい', () => {
    for (const s of songs) {
      expect(s.id).toMatch(/^[A-Za-z0-9._-]+$/)
      for (const a of s.arrangements) expect(a.file).toMatch(/^[^/\\]+\.mid$/)
    }
  })

  it('直下の .mid が全 arrangement の file と一致する', () => {
    const expected = [...new Set(songs.flatMap((s) => s.arrangements.map((a) => a.file)))].sort()
    expect(mids('.')).toEqual(expected)
  })

  it('previews/ の .mid が全曲の <id>.mid と一致する', () => {
    expect(mids('previews/')).toEqual(songs.map((s) => `${s.id}.mid`).sort())
  })
})
