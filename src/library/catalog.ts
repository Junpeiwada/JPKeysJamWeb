// 曲の一覧（songs.json）の型と読み込み・並べ方。手本は JPKeysJam の App/Library/SongCatalog.swift・SongSource.swift。
// Web 版ではアーティスト別・新着の並べ方は使わないので移していない。
import { normalizeSearchText } from './search'

/** 言語ごとの文字列。songs.json の title・composer */
export interface LocalizedText {
  ja: string
  en: string
}

/** 譜面が弾く手。songs.json の arrangements[].hands */
export type ArrangementHands = 'right' | 'both'

/** 1 曲の中の譜面 1 つ（難しさと弾く手ごと） */
export interface SongArrangement {
  id: string
  file: string
  level: number
  hands: ArrangementHands
}

/** 曲のジャンル。songs.json の genre */
export type SongGenre = 'jpop' | 'anime' | 'game' | 'western' | 'classic' | 'kids'

/** ジャンルの並び順（Swift の enum の順） */
export const ALL_GENRES: readonly SongGenre[] = ['jpop', 'anime', 'game', 'western', 'classic', 'kids']

/** 画面に出すジャンル名 */
export function genreTitle(genre: SongGenre): string {
  switch (genre) {
    case 'jpop':
      return 'J-POP'
    case 'anime':
      return 'アニメ・映画'
    case 'game':
      return 'ゲーム'
    case 'western':
      return '洋楽'
    case 'classic':
      return 'クラシック'
    case 'kids':
      return '童謡・こども'
  }
}

/** 曲一覧の 1 曲分（songs.json の 1 要素。読み込み後は arrangements が必ず 1 つ以上ある） */
export interface SongEntry {
  id: string
  file: string
  title: LocalizedText
  composer: LocalizedText
  difficulty: number
  durationSeconds: number
  artist?: LocalizedText
  artistYomi?: string
  genre?: string
  yomi?: string
  featured?: number
  /** 追加日（YYYY-MM-DD） */
  added?: string
  previewMs: number
  arrangements: SongArrangement[]
}

/** 言語コードが ja なら ja、それ以外は en */
export function localizedText(text: LocalizedText, language: string): string {
  return language === 'ja' ? text.ja : text.en
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseLocalized(v: unknown): LocalizedText | null {
  if (!isRecord(v) || typeof v.ja !== 'string' || typeof v.en !== 'string') return null
  return { ja: v.ja, en: v.en }
}

/** 空・空白だけの文字列は「無い」とみなす */
function parseText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

/** file がフォルダ直下のファイル名だけか（"../" や区切りを含まない）。手本は SongSource.swift の isValidFileName */
export function isValidFileName(file: string): boolean {
  return file !== '' && file !== '.' && file !== '..' && !file.includes('/') && !file.includes('\\') && !file.includes('..')
}

/** 1〜3 の整数か（difficulty・level） */
function isValidLevel(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 3
}

function parseArrangement(v: unknown): SongArrangement | null {
  if (!isRecord(v)) return null
  if (typeof v.id !== 'string' || typeof v.file !== 'string' || !Number.isInteger(v.level)) return null
  // 知らない hands の譜面は除く
  if (v.hands !== 'right' && v.hands !== 'both') return null
  return { id: v.id, file: v.file, level: v.level as number, hands: v.hands }
}

/** songs.json の 1 要素を読む。必須の項目が読めなければ null（その曲だけ除く） */
export function parseSongEntry(v: unknown): SongEntry | null {
  if (!isRecord(v)) return null
  const title = parseLocalized(v.title)
  const composer = parseLocalized(v.composer)
  if (typeof v.id !== 'string' || typeof v.file !== 'string' || !title || !composer) return null
  if (!Number.isInteger(v.difficulty) || !Number.isInteger(v.durationSeconds)) return null
  const difficulty = v.difficulty as number
  const durationSeconds = v.durationSeconds as number

  let artist = parseLocalized(v.artist) ?? undefined
  if (artist && artist.ja.trim() === '') artist = undefined

  let arrangements: SongArrangement[] = []
  if (Array.isArray(v.arrangements)) {
    for (const a of v.arrangements) {
      const parsed = parseArrangement(a)
      if (parsed) arrangements.push(parsed)
    }
  }
  // 無い（全部除かれた）ときは file・difficulty から 1 つ作る
  if (arrangements.length === 0) {
    arrangements = [{ id: v.id, file: v.file, level: difficulty, hands: 'both' }]
  }

  // 手本の hasValidValues と isValidFileName の検査。満たさない曲は除く
  if (!isValidLevel(difficulty) || durationSeconds < 0) return null
  if (!arrangements.every((a) => isValidLevel(a.level))) return null
  if (new Set(arrangements.map((a) => a.id)).size !== arrangements.length) return null
  if (!isValidFileName(v.file) || !arrangements.every((a) => isValidFileName(a.file))) return null

  return {
    id: v.id,
    file: v.file,
    title,
    composer,
    difficulty,
    durationSeconds,
    artist,
    artistYomi: artist ? parseText(v.artistYomi) : undefined,
    genre: parseText(v.genre),
    yomi: parseText(v.yomi),
    featured: typeof v.featured === 'number' ? v.featured : undefined,
    added: parseText(v.added),
    previewMs: typeof v.previewMs === 'number' ? v.previewMs : 0,
    arrangements,
  }
}

/** 曲の一覧から作る並べ方（おすすめ・ジャンル）。並べ替えは constructor で済ませる */
export class SongCatalog {
  /** featured がある曲を featured の昇順（同じなら entries の順） */
  readonly featured: SongEntry[]
  /** 曲のあるジャンルだけ、ALL_GENRES の順 */
  readonly genres: SongGenre[]
  private readonly byGenre = new Map<SongGenre, SongEntry[]>()
  private readonly byID = new Map<string, SongEntry>()

  constructor(readonly entries: SongEntry[]) {
    // 同じ ID が重なるときは最初の 1 つ
    for (const entry of entries) {
      if (!this.byID.has(entry.id)) this.byID.set(entry.id, entry)
    }

    this.featured = entries
      .map((entry, index) => ({ entry, index }))
      .filter((x) => x.entry.featured !== undefined)
      .sort((a, b) => a.entry.featured! - b.entry.featured! || a.index - b.index)
      .map((x) => x.entry)

    const buckets = new Map<SongGenre, SongEntry[]>()
    for (const entry of entries) {
      const genre = ALL_GENRES.find((g) => g === entry.genre)
      if (!genre) continue
      const list = buckets.get(genre) ?? []
      list.push(entry)
      buckets.set(genre, list)
    }
    // 読み（無ければ title.ja）の順。同じなら entries の順
    for (const [genre, list] of buckets) {
      const sorted = list
        .map((entry, index) => ({ entry, index, key: normalizeSearchText(entry.yomi ?? entry.title.ja) }))
        .sort((a, b) => (a.key !== b.key ? (a.key < b.key ? -1 : 1) : a.index - b.index))
        .map((x) => x.entry)
      this.byGenre.set(genre, sorted)
    }
    this.genres = ALL_GENRES.filter((g) => buckets.has(g))
  }

  /** ジャンルの曲。読みの順 */
  songs(genre: SongGenre): SongEntry[] {
    return this.byGenre.get(genre) ?? []
  }

  /** 曲 ID の曲。無ければ undefined */
  song(id: string): SongEntry | undefined {
    return this.byID.get(id)
  }
}

/** songs.json を読む。読めない曲は除く。取得に失敗したら例外 */
export async function loadCatalog(
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<SongCatalog> {
  const response = await fetchFn(`${import.meta.env.BASE_URL}songs/songs.json`)
  if (!response.ok) throw new Error(`曲の一覧を読めませんでした (${response.status})`)
  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new Error('曲の一覧の形式が違います')
  }
  return parseCatalog(json)
}

/** songs.json の中身（JSON を読んだ値）から SongCatalog を作る */
export function parseCatalog(json: unknown): SongCatalog {
  if (!Array.isArray(json)) throw new Error('曲の一覧の形式が違います')
  const entries: SongEntry[] = []
  for (const item of json) {
    const entry = parseSongEntry(item)
    if (entry) entries.push(entry)
  }
  return new SongCatalog(entries)
}
