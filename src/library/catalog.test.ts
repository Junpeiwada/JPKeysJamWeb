import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadCatalog, parseCatalog, genreTitle, parseSongEntry, SongCatalog, type SongEntry } from './catalog'

// 手本は JPKeysJam の Tests/SongCatalogTests.swift
function entry(id: string, opts: Partial<SongEntry> = {}): SongEntry {
  return {
    id,
    file: `${id}.mid`,
    title: { ja: id, en: id },
    composer: { ja: '', en: '' },
    difficulty: 1,
    durationSeconds: 10,
    previewMs: 0,
    arrangements: [{ id, file: `${id}.mid`, level: 1, hands: 'both' }],
    ...opts,
  }
}
const ids = (list: SongEntry[]) => list.map((e) => e.id)

describe('SongCatalog', () => {
  it('おすすめは featured の昇順で無いものは除く', () => {
    const catalog = new SongCatalog([
      entry('c', { featured: 3 }),
      entry('x'),
      entry('a', { featured: 1 }),
      entry('b', { featured: 2 }),
    ])
    expect(ids(catalog.featured)).toEqual(['a', 'b', 'c'])
  })

  it('ジャンルは決まった順で、曲の無いジャンルと知らないジャンルを除く', () => {
    const catalog = new SongCatalog([
      entry('k', { genre: 'kids' }),
      entry('j', { genre: 'jpop' }),
      entry('unknown', { genre: 'zzz' }),
      entry('n'),
    ])
    expect(catalog.genres).toEqual(['jpop', 'kids'])
    expect(catalog.songs('game')).toEqual([])
  })

  it('ジャンル内は読みの順（読みが無ければ曲名）', () => {
    const catalog = new SongCatalog([
      entry('b', { yomi: 'ぼ', genre: 'jpop' }),
      entry('a', { yomi: 'ア', genre: 'jpop' }),
      entry('c', { genre: 'jpop' }),
    ])
    expect(ids(catalog.songs('jpop'))).toEqual(['c', 'a', 'b'])
  })

  it('曲 ID から曲を引く。同じ ID が重なれば最初の曲', () => {
    const catalog = new SongCatalog([entry('a', { yomi: '1' }), entry('a', { yomi: '2' }), entry('b')])
    expect(catalog.song('a')?.yomi).toBe('1')
    expect(catalog.song('b')?.id).toBe('b')
    expect(catalog.song('x')).toBeUndefined()
  })
})

describe('parseSongEntry', () => {
  const base = {
    id: 'a',
    file: 'a.1.mid',
    title: { ja: 'あ', en: 'A' },
    composer: { ja: 'い', en: 'I' },
    difficulty: 2,
    durationSeconds: 30,
  }

  it('譜面が無ければ file・difficulty から 1 つ作る', () => {
    const e = parseSongEntry(base)
    expect(e?.arrangements).toEqual([{ id: 'a', file: 'a.1.mid', level: 2, hands: 'both' }])
    expect(e?.previewMs).toBe(0)
  })

  it('知らない hands の譜面だけ除き、空の文字列は無いものとする', () => {
    const e = parseSongEntry({
      ...base,
      yomi: '  ',
      artist: { ja: ' ', en: '' },
      artistYomi: 'x',
      arrangements: [
        { id: 'a.1', file: 'a.1.mid', level: 1, hands: 'left' },
        { id: 'a.2', file: 'a.2.mid', level: 3, hands: 'right' },
      ],
    })
    expect(e?.arrangements.map((a) => a.id)).toEqual(['a.2'])
    expect(e?.yomi).toBeUndefined()
    expect(e?.artist).toBeUndefined()
    expect(e?.artistYomi).toBeUndefined()
  })

  it('file に区切りや .. を含む曲は除く', () => {
    for (const file of ['../a.mid', 'x/a.mid', 'x\\a.mid', '..', '']) {
      expect(parseSongEntry({ ...base, file })).toBeNull()
    }
    const bad = { id: 'a.1', file: '../a.mid', level: 1, hands: 'both' }
    expect(parseSongEntry({ ...base, arrangements: [bad] })).toBeNull()
  })

  it('difficulty・level が 1〜3 の整数でなければ除く', () => {
    expect(parseSongEntry({ ...base, difficulty: 0 })).toBeNull()
    expect(parseSongEntry({ ...base, difficulty: 4 })).toBeNull()
    expect(parseSongEntry({ ...base, difficulty: 1.5 })).toBeNull()
    const a = { id: 'a.1', file: 'a.1.mid', hands: 'both' }
    expect(parseSongEntry({ ...base, arrangements: [{ ...a, level: 4 }] })).toBeNull()
    // 整数でない level の譜面は譜面だけ除かれ、譜面が空になれば補われる
    expect(parseSongEntry({ ...base, arrangements: [{ ...a, level: 1.5 }] })?.arrangements.map((x) => x.id)).toEqual(['a'])
  })

  it('durationSeconds が負なら除く', () => {
    expect(parseSongEntry({ ...base, durationSeconds: -1 })).toBeNull()
    expect(parseSongEntry({ ...base, durationSeconds: 0 })).not.toBeNull()
  })

  it('譜面の id が重なる曲は除く', () => {
    const a = { file: 'a.1.mid', level: 1, hands: 'both' }
    expect(parseSongEntry({ ...base, arrangements: [{ ...a, id: 'x' }, { ...a, id: 'x' }] })).toBeNull()
  })

  it('必須の項目が無ければ null', () => {
    expect(parseSongEntry({ ...base, title: undefined })).toBeNull()
    expect(parseSongEntry(null)).toBeNull()
  })
})

describe('genreTitle', () => {
  it('iOS 版の文字列リソースと同じ 6 つの名前を返す', () => {
    expect(genreTitle('jpop')).toBe('J-POP')
    expect(genreTitle('anime')).toBe('アニメ・映画')
    expect(genreTitle('game')).toBe('ゲーム')
    expect(genreTitle('western')).toBe('洋楽')
    expect(genreTitle('classic')).toBe('クラシック')
    expect(genreTitle('kids')).toBe('童謡・こども')
  })
})

describe('public/songs/songs.json', () => {
  const json: unknown = JSON.parse(readFileSync('public/songs/songs.json', 'utf-8'))

  it('全曲が型どおりに読める', () => {
    expect(Array.isArray(json)).toBe(true)
    const raw = json as unknown[]
    const catalog = parseCatalog(json)
    expect(catalog.entries.length).toBe(raw.length)
    for (const e of catalog.entries) {
      expect(e.arrangements.length).toBeGreaterThan(0)
      expect(e.title.ja).not.toBe('')
    }
  })

  it('featured は昇順に並ぶ', () => {
    const catalog = parseCatalog(json)
    const ranks = catalog.featured.map((e) => e.featured!)
    expect(ranks.length).toBeGreaterThan(0)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(catalog.genres.length).toBeGreaterThan(0)
  })

  it('loadCatalog は JSON が壊れていれば日本語のメッセージで失敗する', async () => {
    await expect(loadCatalog(async () => new Response('{'))).rejects.toThrow('曲の一覧の形式が違います')
  })

  it('loadCatalog は songs/songs.json を取りに行く', async () => {
    let requested = ''
    const catalog = await loadCatalog(async (url) => {
      requested = url
      return new Response(JSON.stringify(json))
    })
    expect(requested.endsWith('songs/songs.json')).toBe(true)
    expect(catalog.entries.length).toBeGreaterThan(0)
  })
})
