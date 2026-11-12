/** 弾いた記録 1 件。曲・譜面・弾いた日時（epoch ms） */
export interface PlayRecord {
  id: string
  songID: string
  arrangementID: string
  playedAt: number
}

/** localStorage 互換の保存先 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 持っておく件数の上限。超えたら古いものから落とす */
export const HISTORY_LIMIT = 200

export const HISTORY_KEY = 'jpkeysjam.history.playRecords'

/** 既定の保存先。localStorage が無い・触れないときは null */
function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function newID(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(v: unknown): v is PlayRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.songID === 'string' &&
    typeof r.arrangementID === 'string' &&
    typeof r.playedAt === 'number' &&
    Number.isFinite(r.playedAt)
  )
}

/** 弾いた曲の履歴。新しい順に最大 200 件を JSON で保存する。
 *  変更のたびに保存する。読めない・壊れた値は空として扱い、例外は外に出さない */
export class PlayHistory {
  private records: PlayRecord[]

  constructor(
    private readonly storage: StorageLike | null = defaultStorage(),
    private readonly now: () => number = () => Date.now(),
    private readonly key: string = HISTORY_KEY,
  ) {
    this.records = this.load()
  }

  /** 新しい順の全件 */
  all(): PlayRecord[] {
    return [...this.records]
  }

  /** 弾いた記録を先頭に足す。上限を超えた分は古いものから落とす */
  record(songID: string, arrangementID: string): PlayRecord {
    const rec: PlayRecord = { id: newID(), songID, arrangementID, playedAt: this.now() }
    this.records.unshift(rec)
    if (this.records.length > HISTORY_LIMIT) this.records.length = HISTORY_LIMIT
    this.save()
    return rec
  }

  /** 記録を 1 件消す（id で探す。無ければ何もしない） */
  remove(id: string): void {
    const i = this.records.findIndex((r) => r.id === id)
    if (i < 0) return
    this.records.splice(i, 1)
    this.save()
  }

  clearAll(): void {
    this.records = []
    this.save()
  }

  /** 曲ごとに最新 1 件にした記録を、新しい順に最大 limit 件。
   *  isIncluded が false の曲は数えずに飛ばし、条件に合う曲で limit 件まで埋める */
  recentSongs(limit: number, isIncluded: (songID: string) => boolean = () => true): PlayRecord[] {
    if (!(limit > 0)) return []
    const seen = new Set<string>()
    const result: PlayRecord[] = []
    for (const r of this.records) {
      if (!isIncluded(r.songID) || seen.has(r.songID)) continue
      seen.add(r.songID)
      result.push(r)
      if (result.length === limit) break
    }
    return result
  }

  private load(): PlayRecord[] {
    try {
      const raw = this.storage?.getItem(this.key)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      // 壊れた要素は捨て、上限で切る
      return parsed.filter(isRecord).slice(0, HISTORY_LIMIT)
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.records))
    } catch {
      // 書き込めなくてもメモリ上では動かす
    }
  }
}
