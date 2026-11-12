// 曲の検索。曲名・アーティスト・作曲者・読みに部分一致させる。手本は JPKeysJam の App/Library/SongSearch.swift。
// catalog.ts が normalizeSearchText を使うので、こちらは型だけを読んで循環を避ける
import type { SongEntry } from './catalog'

/**
 * 検索と並べ替え用に文字をそろえる。
 * カタカナ→ひらがな、全角英数→半角、小文字、長音・横棒（ー 一 － ‐ など）を「ー」に統一し、中黒（・ ･ · •）と空白を除く
 */
export function normalizeSearchText(text: string): string {
  // NFKC で半角カナ→全角カナ（濁点も合成）、全角英数→半角にそろう
  const folded = text.normalize('NFKC').toLowerCase()
  let result = ''
  for (const ch of folded) {
    const code = ch.codePointAt(0)!
    if (code >= 0x30a1 && code <= 0x30f6) {
      // カタカナ → ひらがな
      result += String.fromCodePoint(code - 0x60)
    } else if (
      code === 0x30fc ||
      code === 0x4e00 ||
      (code >= 0x2010 && code <= 0x2015) ||
      code === 0x2212 ||
      code === 0x2d ||
      code === 0xff0d ||
      code === 0xff70
    ) {
      // 長音・漢数字の一・各種ハイフン → 長音
      result += 'ー'
    } else if (code === 0x30fb || code === 0xff65 || code === 0xb7 || code === 0x2022) {
      // 中黒は除く
    } else if (/\s/u.test(ch)) {
      // 空白は除く
    } else {
      result += ch
    }
  }
  return result
}

/**
 * 検索結果。空・空白だけの query は []。
 * 曲名（表示言語・ja・en・読み）の頭に一致するものを先に、残りを後に並べる。各群の中は entries の順
 */
export function searchSongs(query: string, entries: readonly SongEntry[], language: string): SongEntry[] {
  const q = normalizeSearchText(query)
  if (q === '') return []

  const head: SongEntry[] = []
  const rest: SongEntry[] = []
  for (const entry of entries) {
    const titles = [
      normalizeSearchText(language === 'ja' ? entry.title.ja : entry.title.en),
      normalizeSearchText(entry.title.ja),
      normalizeSearchText(entry.title.en),
      normalizeSearchText(entry.yomi ?? ''),
    ]
    if (titles.some((t) => t.startsWith(q))) {
      head.push(entry)
      continue
    }
    const others = [
      ...titles,
      normalizeSearchText(entry.artist?.ja ?? ''),
      normalizeSearchText(entry.artist?.en ?? ''),
      normalizeSearchText(entry.artistYomi ?? ''),
      normalizeSearchText(entry.composer.ja),
      normalizeSearchText(entry.composer.en),
    ]
    if (others.some((t) => t.includes(q))) rest.push(entry)
  }
  return [...head, ...rest]
}
