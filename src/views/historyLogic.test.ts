import { describe, it, expect } from 'vitest'
import { SongCatalog, type SongArrangement, type SongEntry } from '../library/catalog'
import type { PlayRecord } from '../library/history'
import { arrangementText, dayOf, groupRecords, timeText, visibleRecords } from './historyLogic'

const TZ = 'Asia/Tokyo'

/** 東京の日時（月は 1 始まり）を epoch ms にする */
function date(y: number, m: number, d: number, h: number, min: number): number {
  return Date.UTC(y, m - 1, d, h - 9, min)
}

/** 2026-10-30 12:00（東京） */
const now = date(2026, 10, 30, 12, 0)

let seq = 0
function record(songID: string, playedAt: number, arrangementID?: string): PlayRecord {
  return { id: `r${seq++}`, songID, arrangementID: arrangementID ?? songID, playedAt }
}

function entry(id: string, arrangements: SongArrangement[] = []): SongEntry {
  return {
    id,
    file: `${id}.mid`,
    title: { ja: id, en: id },
    composer: { ja: '', en: '' },
    difficulty: 1,
    durationSeconds: 10,
    previewMs: 0,
    arrangements,
  }
}

describe('区切り', () => {
  it('今日・昨日・それより前', () => {
    expect(dayOf(date(2026, 10, 30, 0, 0), now, TZ)).toBe('today')
    expect(dayOf(date(2026, 10, 30, 11, 59), now, TZ)).toBe('today')
    expect(dayOf(date(2026, 10, 29, 23, 59), now, TZ)).toBe('yesterday')
    expect(dayOf(date(2026, 10, 29, 0, 0), now, TZ)).toBe('yesterday')
    expect(dayOf(date(2026, 10, 28, 23, 59), now, TZ)).toBe('earlier')
  })

  it('未来の時刻は今日に入れる', () => {
    expect(dayOf(date(2026, 10, 31, 9, 0), now, TZ)).toBe('today')
  })

  it('月をまたいでも昨日は前の日', () => {
    const first = date(2026, 11, 1, 8, 0)
    expect(dayOf(date(2026, 10, 31, 22, 0), first, TZ)).toBe('yesterday')
    expect(dayOf(date(2026, 10, 30, 22, 0), first, TZ)).toBe('earlier')
  })

  it('区切りごとにまとめ、順番は保ち、空の区切りは出さない', () => {
    const a = record('a', date(2026, 10, 30, 11, 0))
    const b = record('b', date(2026, 10, 30, 9, 0))
    const c = record('c', date(2026, 10, 20, 9, 0))
    const groups = groupRecords([a, b, c], now, TZ)
    expect(groups.map((g) => g.day)).toEqual(['today', 'earlier'])
    expect(groups[0].records).toEqual([a, b])
    expect(groups[1].records).toEqual([c])
    expect(groupRecords([], now, TZ)).toEqual([])
  })
})

describe('行の文字', () => {
  it('今日と昨日は時刻、それより前は日付', () => {
    expect(timeText(date(2026, 10, 30, 21, 4), 'today', now, TZ)).toBe('21:04')
    expect(timeText(date(2026, 10, 29, 9, 5), 'yesterday', now, TZ)).toBe('09:05')
    expect(timeText(date(2026, 10, 27, 21, 4), 'earlier', now, TZ)).toBe('10/27')
    expect(timeText(date(2026, 1, 5, 21, 4), 'earlier', now, TZ)).toBe('1/5')
  })

  it('今と年が違うそれより前は年つきで出す', () => {
    expect(timeText(date(2025, 10, 27, 21, 4), 'earlier', now, TZ)).toBe('2025/10/27')
  })

  it('0 時台も 00 と出す', () => {
    expect(timeText(date(2026, 10, 30, 0, 7), 'today', now, TZ)).toBe('00:07')
  })

  it('譜面の名前は難しさと手', () => {
    const e = entry('a', [
      { id: 'a.1', file: 'a.1.mid', level: 1, hands: 'right' },
      { id: 'a.2', file: 'a.2.mid', level: 2, hands: 'both' },
      { id: 'a.3', file: 'a.3.mid', level: 3, hands: 'both' },
    ])
    expect(arrangementText(record('a', now, 'a.1'), e)).toBe('やさしい・右手')
    expect(arrangementText(record('a', now, 'a.2'), e)).toBe('ふつう・両手')
    expect(arrangementText(record('a', now, 'a.3'), e)).toBe('むずかしい・両手')
  })

  it('曲に無い譜面は名前を出さない', () => {
    expect(arrangementText(record('a', now, 'zzz'), entry('a'))).toBeUndefined()
  })
})

describe('一覧に無い曲', () => {
  it('今の曲一覧に無い曲の記録は除く', () => {
    const catalog = new SongCatalog([entry('a'), entry('b')])
    const records = [record('a', now), record('gone', now), record('b', now), record('a', now)]
    expect(visibleRecords(records, catalog).map((r) => r.songID)).toEqual(['a', 'b', 'a'])
  })
})
