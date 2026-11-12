// SMF（Standard MIDI File）の読み込み。手本は SoundEngine の JPMIDIKit/SMFParser.swift
// Swift との違い: ポリプレッシャー・チャンネルプレッシャーは捨てる。
// 0x80 の Note Off はファイルのベロシティをそのまま残す。
import type { MidiMessage, TimedMidiEvent } from './types'

export class SmfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmfError'
  }
}

export interface SmfSong {
  /** 最初のトラックの Track Name（無ければ null） */
  title: string | null
  /** 全トラックを時刻順にまとめたもの（同時刻はファイル上の順を保つ） */
  events: TimedMidiEvent[]
  /** 曲の長さ（秒）。最後のイベントと End of Track の遅い方 */
  duration: number
  /** Note On が 1 つでもある ch */
  usedChannels: Set<number>
  /** ch → 最初の Program Change */
  initialPrograms: Map<number, number>
  /** ch → そのトラックの Track Name（あれば） */
  trackNames: Map<number, string>
}

interface RawEvent {
  tick: number
  message: MidiMessage
}

interface TrackInfo {
  name: string | null
  channels: number[]
  /** End of Track の tick（無ければ最後のイベントの tick） */
  endTick: number
}

/** 範囲外を読んだら SmfError を投げるバイト列リーダー */
class ByteReader {
  position = 0
  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.position
  }

  u8(): number {
    if (this.position >= this.bytes.length) throw new SmfError('データが途中で終わっています')
    return this.bytes[this.position++]
  }

  u16(): number {
    const hi = this.u8()
    return (hi << 8) | this.u8()
  }

  u32(): number {
    let value = 0
    for (let i = 0; i < 4; i++) value = value * 256 + this.u8()
    return value
  }

  read(count: number): Uint8Array {
    if (count < 0 || count > this.remaining) throw new SmfError('データが途中で終わっています')
    const out = this.bytes.subarray(this.position, this.position + count)
    this.position += count
    return out
  }

  skip(count: number): void {
    this.read(count)
  }

  /** 1 バイト戻す（ランニングステータスのデータバイトを読み直すため） */
  back(): void {
    this.position -= 1
  }

  /** 可変長数値（最大 4 バイト） */
  variableLength(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const byte = this.u8()
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new SmfError('可変長数値が不正です')
  }
}

function tag(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

function decodeText(bytes: Uint8Array): string | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      text = new TextDecoder('shift_jis', { fatal: true }).decode(bytes)
    } catch {
      text = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
    }
  }
  // 末尾の NUL や空白を取り除き、空になったら null
  const trimmed = text.replace(/^[\s\0]+|[\s\0]+$/g, '')
  return trimmed === '' ? null : trimmed
}

function parseTrack(
  body: Uint8Array,
  raws: RawEvent[],
  tempos: { tick: number; micros: number }[],
): TrackInfo {
  const r = new ByteReader(body)
  const info: TrackInfo = { name: null, channels: [], endTick: 0 }
  let tick = 0
  let running: number | null = null

  while (r.remaining > 0) {
    tick += r.variableLength()
    let status = r.u8()

    if (status < 0x80) {
      // ランニングステータス: 直前のステータスを使い回す
      if (running === null) throw new SmfError('ランニングステータスの前にステータスがありません')
      status = running
      r.back()
    }

    if (status === 0xff) {
      running = null
      const type = r.u8()
      const length = r.variableLength()
      const payload = r.read(length)
      if (type === 0x2f) {
        // End of Track
        info.endTick = tick
        return info
      }
      if (type === 0x51 && payload.length === 3) {
        const micros = (payload[0] << 16) | (payload[1] << 8) | payload[2]
        if (micros > 0) tempos.push({ tick, micros })
      } else if (type === 0x03 && info.name === null) {
        info.name = decodeText(payload)
      }
    } else if (status === 0xf0 || status === 0xf7) {
      running = null
      r.skip(r.variableLength())
    } else if (status >= 0x80 && status <= 0xef) {
      running = status
      const channel = status & 0x0f
      const kind = status & 0xf0
      const d1 = r.u8()
      const hasSecondByte = kind !== 0xc0 && kind !== 0xd0
      const d2 = hasSecondByte ? r.u8() : 0
      if (!info.channels.includes(channel)) info.channels.push(channel)
      let message: MidiMessage | null = null
      switch (kind) {
        case 0x80:
          message = { type: 'noteOff', channel, note: d1 & 0x7f, velocity: d2 & 0x7f }
          break
        case 0x90:
          // ベロシティ 0 の Note On は Note Off として扱う
          message =
            d2 === 0
              ? { type: 'noteOff', channel, note: d1 & 0x7f, velocity: 0 }
              : { type: 'noteOn', channel, note: d1 & 0x7f, velocity: d2 & 0x7f }
          break
        case 0xb0:
          message = { type: 'controlChange', channel, controller: d1 & 0x7f, value: d2 & 0x7f }
          break
        case 0xc0:
          message = { type: 'programChange', channel, program: d1 & 0x7f }
          break
        case 0xe0:
          message = { type: 'pitchBend', channel, value: (d1 & 0x7f) | ((d2 & 0x7f) << 7) }
          break
        default:
          // ポリプレッシャー・チャンネルプレッシャーは扱わない（読み飛ばす）
          break
      }
      if (message) raws.push({ tick, message })
    } else {
      // F1〜F6, F8〜FE はスタンダード MIDI ファイルに現れない
      throw new SmfError('不正なステータスバイトです')
    }
  }
  info.endTick = tick
  return info
}

export function parseSmf(bytes: Uint8Array): SmfSong {
  const r = new ByteReader(bytes)

  // ヘッダ（MThd）
  if (bytes.length < 4 || tag(bytes.subarray(0, 4)) !== 'MThd') {
    throw new SmfError('MThd がありません')
  }
  r.skip(4)
  const headerLength = r.u32()
  if (headerLength < 6) throw new SmfError('ヘッダが短すぎます')
  const format = r.u16()
  const trackCount = r.u16()
  const division = r.u16()
  r.skip(headerLength - 6)
  if (format !== 0 && format !== 1) throw new SmfError(`未対応のフォーマットです: ${format}`)
  if (division & 0x8000) throw new SmfError('SMPTE 形式の division には未対応です')
  if (division === 0) throw new SmfError('division が 0 です')

  // トラック。MTrk 以外のチャンクは読み飛ばす
  const raws: RawEvent[] = []
  const tempos: { tick: number; micros: number }[] = []
  let title: string | null = null
  const trackNames = new Map<number, string>()
  let parsedTracks = 0
  let maxEndTick = 0
  while (parsedTracks < trackCount && r.remaining >= 8) {
    const chunkTag = tag(r.read(4))
    const length = r.u32()
    if (length > r.remaining) throw new SmfError('トラックが途中で終わっています')
    const body = r.read(length)
    if (chunkTag !== 'MTrk') continue
    const trackIndex = parsedTracks
    parsedTracks++

    const track = parseTrack(body, raws, tempos)
    maxEndTick = Math.max(maxEndTick, track.endTick)
    if (trackIndex === 0) title = track.name
    if (track.name !== null) {
      for (const ch of track.channels) if (!trackNames.has(ch)) trackNames.set(ch, track.name)
    }
  }
  if (parsedTracks === 0) throw new SmfError('トラックがありません')

  // 同時刻はファイル上の順（トラック順→トラック内の順）を保つ。配列の sort は安定
  const sorted = raws.map((raw, i) => ({ raw, i })).sort((a, b) => a.raw.tick - b.raw.tick || a.i - b.i).map((x) => x.raw)
  const tempoList = tempos.map((t, i) => ({ t, i })).sort((a, b) => a.t.tick - b.t.tick || a.i - b.i).map((x) => x.t)

  // テンポマップ: 各区間の開始 tick・開始秒・1 拍の長さ（マイクロ秒）
  const segments: { tick: number; seconds: number; micros: number }[] = [
    { tick: 0, seconds: 0, micros: 500_000 },
  ]
  for (const t of tempoList) {
    const last = segments[segments.length - 1]
    if (t.tick === last.tick) {
      last.micros = t.micros
    } else {
      const seconds = last.seconds + ((t.tick - last.tick) * last.micros) / 1_000_000 / division
      segments.push({ tick: t.tick, seconds, micros: t.micros })
    }
  }

  const secondsAt = (tick: number, seg: { tick: number; seconds: number; micros: number }) =>
    seg.seconds + ((tick - seg.tick) * seg.micros) / 1_000_000 / division

  const events: TimedMidiEvent[] = []
  const usedChannels = new Set<number>()
  const initialPrograms = new Map<number, number>()
  let segIndex = 0
  for (const raw of sorted) {
    while (segIndex + 1 < segments.length && segments[segIndex + 1].tick <= raw.tick) segIndex++
    events.push({ time: secondsAt(raw.tick, segments[segIndex]), message: raw.message })
    if (raw.message.type === 'noteOn') usedChannels.add(raw.message.channel)
    else if (raw.message.type === 'programChange' && !initialPrograms.has(raw.message.channel)) {
      initialPrograms.set(raw.message.channel, raw.message.program)
    }
  }

  // End of Track の tick を秒に直す（その tick 以前で最後の区間を引く）
  let endSeg = segments[0]
  for (const s of segments) if (s.tick <= maxEndTick) endSeg = s
  const duration = Math.max(events.length > 0 ? events[events.length - 1].time : 0, secondsAt(maxEndTick, endSeg))

  return { title, events, duration, usedChannels, initialPrograms, trackNames }
}
