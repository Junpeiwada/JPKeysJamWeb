import type { PlayRecord } from '../library/history'
import type { SongCatalog, SongEntry } from '../library/catalog'
import { handsName, levelName } from './SongDetail'

/** 履歴の区切り。上から今日・昨日・それより前 */
export type HistoryDay = 'today' | 'yesterday' | 'earlier'

export const HISTORY_DAYS: readonly HistoryDay[] = ['today', 'yesterday', 'earlier']

export function historyDayTitle(day: HistoryDay): string {
  switch (day) {
    case 'today':
      return '今日'
    case 'yesterday':
      return '昨日'
    case 'earlier':
      return 'それより前'
  }
}

export interface HistoryGroup {
  day: HistoryDay
  records: PlayRecord[]
}

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** 指定のタイムゾーンでの年月日時分 */
function partsOf(ms: number, timeZone: string): Parts {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    formatters.set(timeZone, f)
  }
  const m: Record<string, number> = {}
  for (const p of f.formatToParts(ms)) {
    if (p.type !== 'literal') m[p.type] = Number(p.value)
  }
  return { year: m.year, month: m.month, day: m.day, hour: m.hour % 24, minute: m.minute }
}

/** 暦の日を通し番号にする（日付の差を数えるため） */
function dayNumber(p: Parts): number {
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000)
}

/** 記録がどの区切りか。now と同じ日（未来も）は今日、前の日は昨日、それ以前は「それより前」 */
export function dayOf(playedAt: number, now: number, timeZone: string): HistoryDay {
  const diff = dayNumber(partsOf(now, timeZone)) - dayNumber(partsOf(playedAt, timeZone))
  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  return 'earlier'
}

/** 区切りごとにまとめる。今日・昨日・それより前の順で、空の区切りは出さない。中は records の順 */
export function groupRecords(records: readonly PlayRecord[], now: number, timeZone: string): HistoryGroup[] {
  const buckets: Record<HistoryDay, PlayRecord[]> = { today: [], yesterday: [], earlier: [] }
  for (const r of records) buckets[dayOf(r.playedAt, now, timeZone)].push(r)
  return HISTORY_DAYS.filter((d) => buckets[d].length > 0).map((d) => ({ day: d, records: buckets[d] }))
}

const two = (n: number) => String(n).padStart(2, '0')

/** 行の右に出す文字。今日・昨日は時刻（21:04）、それより前は日付（10/27。now と年が違えば 2025/10/27） */
export function timeText(playedAt: number, day: HistoryDay, now: number, timeZone: string): string {
  const p = partsOf(playedAt, timeZone)
  if (day !== 'earlier') return `${two(p.hour)}:${two(p.minute)}`
  if (p.year !== partsOf(now, timeZone).year) return `${p.year}/${p.month}/${p.day}`
  return `${p.month}/${p.day}`
}

/** 譜面の名前。「ふつう・両手」。譜面が曲に無いときは undefined */
export function arrangementText(record: PlayRecord, entry: SongEntry): string | undefined {
  const a = entry.arrangements.find((x) => x.id === record.arrangementID)
  return a ? `${levelName(a.level)}・${handsName(a.hands)}` : undefined
}

/** 今の曲一覧にある曲の記録だけ。順番はそのまま */
export function visibleRecords(records: readonly PlayRecord[], catalog: SongCatalog): PlayRecord[] {
  return records.filter((r) => catalog.song(r.songID) !== undefined)
}
