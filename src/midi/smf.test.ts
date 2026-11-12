import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSmf, SmfError } from './smf'

// --- 手組みの SMF を作る補助 ---
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const vlq = (n: number): number[] => {
  const out = [n & 0x7f]
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80)
  return out
}
const track = (body: number[]) => [...Array.from('MTrk', (c) => c.charCodeAt(0)), ...u32(body.length), ...body]
const smf = (format: number, division: number, tracks: number[][]) =>
  new Uint8Array([
    ...Array.from('MThd', (c) => c.charCodeAt(0)),
    ...u32(6),
    ...u16(format),
    ...u16(tracks.length),
    ...u16(division),
    ...tracks.flatMap(track),
  ])
const endOfTrack = (delta = 0) => [...vlq(delta), 0xff, 0x2f, 0x00]
const tempo = (delta: number, micros: number) => [...vlq(delta), 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff]

describe('parseSmf', () => {
  it('format 0: 内容と時刻（division 500・テンポ 120 で 1 tick = 1 ms）', () => {
    const bytes = smf(0, 500, [
      [
        ...tempo(0, 500_000),
        0x00, 0xc0, 5, // programChange ch0
        0x00, 0x90, 60, 100, // noteOn
        ...vlq(1000), 0x80, 60, 0x40, // noteOff 1 秒後
        ...endOfTrack(500),
      ],
    ])
    const song = parseSmf(bytes)
    expect(song.events.map((e) => e.message)).toEqual([
      { type: 'programChange', channel: 0, program: 5 },
      { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
      { type: 'noteOff', channel: 0, note: 60, velocity: 0x40 },
    ])
    expect(song.events[2].time).toBeCloseTo(1, 9)
    expect(song.duration).toBeCloseTo(1.5, 9)
    expect(song.usedChannels).toEqual(new Set([0]))
    expect(song.initialPrograms.get(0)).toBe(5)
  })

  it('format 1: テンポ変更が全トラックに効き、同時刻はファイル順を保つ', () => {
    // division 480。tick 480 で 120 → 60 BPM（1 拍 1 秒）に変わる
    const tempoTrack = [...tempo(0, 500_000), ...tempo(480, 1_000_000), ...endOfTrack(0)]
    const t1 = [
      0x00, 0x90, 60, 90,
      ...vlq(480), 0x80, 60, 0, // 0.5 秒
      ...vlq(480), 0x90, 62, 90, // 480 tick 後 = 60 BPM で 1 秒 → 1.5 秒
      ...endOfTrack(0),
    ]
    const t2 = [0x00, 0x91, 64, 80, ...vlq(480), 0x81, 64, 0, ...endOfTrack(0)]
    const song = parseSmf(smf(1, 480, [tempoTrack, t1, t2]))
    const times = song.events.map((e) => e.time)
    expect(times[0]).toBeCloseTo(0, 9)
    expect(times[1]).toBeCloseTo(0, 9)
    // 同時刻は t1（トラック順が先）→ t2
    expect(song.events[0].message).toMatchObject({ channel: 0, note: 60 })
    expect(song.events[1].message).toMatchObject({ channel: 1, note: 64 })
    expect(times[2]).toBeCloseTo(0.5, 9)
    expect(times[3]).toBeCloseTo(0.5, 9)
    expect(times[4]).toBeCloseTo(1.5, 9)
    expect(song.usedChannels).toEqual(new Set([0, 1]))
  })

  it('ベロシティ 0 の Note On は noteOff、ランニングステータスも読める', () => {
    const bytes = smf(0, 500, [
      [
        0x00, 0x90, 60, 100,
        0x0a, 62, 100, // ランニングステータスの noteOn
        0x0a, 60, 0, // ランニングステータスのベロシティ 0
        ...endOfTrack(0),
      ],
    ])
    const song = parseSmf(bytes)
    expect(song.events.map((e) => [e.time, e.message.type])).toEqual([
      [0, 'noteOn'],
      [0.01, 'noteOn'],
      [0.02, 'noteOff'],
    ])
    expect(song.events[2].message).toMatchObject({ note: 60, velocity: 0 })
  })

  it('CC とピッチベンドを読む', () => {
    const song = parseSmf(smf(0, 500, [[0x00, 0xb1, 64, 127, 0x00, 0xe1, 0x00, 0x40, ...endOfTrack(0)]]))
    expect(song.events.map((e) => e.message)).toEqual([
      { type: 'controlChange', channel: 1, controller: 64, value: 127 },
      { type: 'pitchBend', channel: 1, value: 8192 },
    ])
  })

  it('壊れたファイルと SMPTE は SmfError', () => {
    expect(() => parseSmf(new Uint8Array([1, 2, 3]))).toThrow(SmfError)
    expect(() => parseSmf(smf(0, 0x8000 | 0x1900, [endOfTrack()]))).toThrow(SmfError)
    expect(() => parseSmf(smf(2, 480, [endOfTrack()]))).toThrow(SmfError)
    const ok = smf(0, 500, [[0x00, 0x90, 60, 100, ...endOfTrack(0)]])
    expect(() => parseSmf(ok.subarray(0, ok.length - 6))).toThrow(SmfError)
  })

  it('UTF-8 でも Shift_JIS でも不正なトラック名は latin1 として読む', () => {
    const name = [0x81, 0x7f, 0xe9]
    const bytes = smf(0, 500, [
      [0x00, 0xff, 0x03, name.length, ...name, 0x00, 0x90, 60, 100, ...endOfTrack(0)],
    ])
    expect(parseSmf(bytes).trackNames.get(0)).toBe('\u0081\u007fé')
  })

  it('実物 bach.air.1.mid を読める', () => {
    const song = parseSmf(new Uint8Array(readFileSync(new URL('../../public/songs/bach.air.1.mid', import.meta.url))))
    const noteOnChannels = new Set(
      song.events.filter((e) => e.message.type === 'noteOn').map((e) => e.message.channel),
    )
    expect(noteOnChannels.has(0)).toBe(true)
    expect(noteOnChannels.has(1)).toBe(true)
    for (let i = 1; i < song.events.length; i++) {
      expect(song.events[i].time).toBeGreaterThanOrEqual(song.events[i - 1].time)
    }
    expect(song.duration).toBeGreaterThan(100)
    expect(song.duration).toBeLessThan(116)
  })
})
