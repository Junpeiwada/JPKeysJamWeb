import { describe, expect, it } from 'vitest'
import type { SongEntry } from './catalog'
import { normalizeSearchText as normalize, searchSongs } from './search'

// 手本は JPKeysJam の Tests/SongSearchTests.swift。同じ入力・同じ期待値
function entry(
  id: string,
  ja: string,
  en: string,
  opts: { yomi?: string; artist?: [string, string]; artistYomi?: string; composer?: [string, string] } = {},
): SongEntry {
  return {
    id,
    file: `${id}.mid`,
    title: { ja, en },
    composer: { ja: opts.composer?.[0] ?? '', en: opts.composer?.[1] ?? '' },
    difficulty: 1,
    durationSeconds: 10,
    artist: opts.artist ? { ja: opts.artist[0], en: opts.artist[1] } : undefined,
    artistYomi: opts.artistYomi,
    yomi: opts.yomi,
    previewMs: 0,
    arrangements: [{ id, file: `${id}.mid`, level: 1, hands: 'both' }],
  }
}

const sample: SongEntry[] = [
  entry('sakura', '桜の栞', 'Sakura no Shiori', { yomi: 'さくらのしおり', artist: ['AKB48', 'AKB48'], artistYomi: 'えーけーびー' }),
  entry('letitgo', 'レット・イット・ゴー', 'Let It Go', { yomi: 'れっといっとごー' }),
  entry('koi', '恋するフォーチュンクッキー', 'Fortune Cookie', {
    yomi: 'こいするふぉーちゅんくっきー',
    artist: ['AKB48', 'AKB48'],
    artistYomi: 'えーけーびー',
  }),
  entry('sakuranbo', 'さくらんぼ', 'Sakuranbo', { yomi: 'さくらんぼ' }),
  entry('hanasakura', '春のさくら', 'Spring Sakura', { yomi: 'はるのさくら' }),
]

const ids = (list: SongEntry[]) => list.map((e) => e.id)
const search = (q: string, list: SongEntry[] = sample, lang = 'ja') => searchSongs(q, list, lang)

describe('searchSongs', () => {
  it('ひらがなカタカナを同じに扱う', () => {
    expect(ids(search('さくら'))).toContain('sakura')
    expect(ids(search('サクラ'))).toContain('sakura')
  })

  it('半角カナとかなでレットイットゴーに当たる', () => {
    expect(ids(search('ﾚｯﾄ'))).toEqual(['letitgo'])
    expect(ids(search('れっといっと'))).toEqual(['letitgo'])
  })

  it('英字は全角半角と大文字小文字を区別しない', () => {
    expect(ids(search('akb'))).toEqual(['sakura', 'koi'])
    expect(ids(search('ＡＫＢ'))).toEqual(['sakura', 'koi'])
  })

  it('長音と漢数字の一と横棒を同じに扱う', () => {
    expect(normalize('ごー')).toBe(normalize('ご一'))
    expect(normalize('ごー')).toBe(normalize('ごｰ'))
    expect(normalize('ごー')).toBe(normalize('ご－'))
    expect(normalize('ごー')).toBe(normalize('ご‐'))
    expect(ids(search('ごー'))).toEqual(['letitgo'])
    expect(ids(search('ご一'))).toEqual(['letitgo'])
  })

  it('中黒と空白は無視する', () => {
    expect(normalize('レット・イット ゴー')).toBe(normalize('れっといっとごー'))
  })

  it('各種の中黒を無視する', () => {
    const expected = normalize('れっといっとごー')
    for (const dot of ['・', '･', '·', '•']) {
      expect(normalize(`レット${dot}イット${dot}ゴー`)).toBe(expected)
    }
  })

  it('アーティストの読みだけに当たる検索', () => {
    // 「えーけーびー」は曲名・アーティスト名のどちらにも無く、artistYomi にだけある
    expect(ids(search('えーけー'))).toEqual(['sakura', 'koi'])
  })

  it('英題の頭に当たる検索は先に出る', () => {
    // 「let」は英題 Let It Go の頭。日本語表示でも頭一致として先に並ぶ
    const list = [entry('a', 'あ', 'Outlet', { artist: ['Letter', 'Letter'] }), entry('b', 'いー', 'Let It Go')]
    expect(ids(search('let', list))).toEqual(['b', 'a'])
  })

  it('曲名の頭に一致するものが先に出る', () => {
    // 「さくら」: さくらんぼ（頭一致）と桜の栞（読みの頭）が先、春のさくらは後
    expect(ids(search('さくら'))).toEqual(['sakura', 'sakuranbo', 'hanasakura'])
    expect(ids(search('さくら', [...sample].reverse()))).toEqual(['sakuranbo', 'sakura', 'hanasakura'])
  })

  it('空や空白だけの検索は空を返す', () => {
    expect(search('')).toEqual([])
    expect(search('  　')).toEqual([])
  })

  it('一致しなければ空', () => {
    expect(search('zzzz', sample, 'en')).toEqual([])
  })

  it('作曲者でも当たる', () => {
    const list = [
      ...sample,
      entry('air', 'G線上のアリア', 'Air on the G String', { composer: ['J.S.バッハ', 'J.S. Bach'] }),
    ]
    expect(ids(search('バッハ', list))).toEqual(['air'])
    expect(ids(search('bach', list))).toEqual(['air'])
  })
})
