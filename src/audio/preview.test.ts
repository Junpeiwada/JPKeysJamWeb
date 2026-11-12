// PreviewPlayer のテスト。手本は JPKeysJam の Tests/PreviewPlayerTests.swift。時計は手で進め、fetch と音の出口は差し替える
import { describe, expect, it, vi } from 'vitest'
import type { SmfSong } from '../midi/smf'
import type { MidiMessage } from '../midi/types'
import { PreviewPlayer } from './preview'
import type { PlayerClock } from './smfPlayer'

class ManualClock implements PlayerClock {
  private time = 0
  now(): number {
    return this.time
  }
  advance(seconds: number): void {
    this.time += seconds
  }
}

/** 長さ duration 秒の短い曲（ch1 に 1 音） */
function makeSong(duration: number): SmfSong {
  return {
    title: null,
    events: [
      { time: 0, message: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
      { time: duration * 0.5, message: { type: 'noteOff', channel: 0, note: 60, velocity: 0 } },
    ],
    duration,
    usedChannels: new Set([0]),
    initialPrograms: new Map(),
    trackNames: new Map(),
  }
}

/** 長さ 1 秒・ch1 に C4 を鳴らす最小の SMF（division 480、120bpm） */
function makeSmfBytes(): Uint8Array {
  const track = [
    0x00, 0x90, 60, 100, // 0 tick: noteOn
    0x83, 0x60, 0x80, 60, 0, // 480 tick: noteOff
    0x00, 0xff, 0x2f, 0x00,
  ]
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]
  const chunk = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track]
  return new Uint8Array([...header, ...chunk])
}

function setup() {
  const clock = new ManualClock()
  const log: MidiMessage[] = []
  const urls: string[] = []
  const player = new PreviewPlayer({
    sink: (m) => log.push(m),
    clock,
    usesTimer: false,
    baseUrl: '/songs/previews/',
    fetchFn: (url) => {
      urls.push(url)
      return Promise.resolve(new Response(new Uint8Array(makeSmfBytes())))
    },
  })
  return { player, clock, log, urls }
}

describe('PreviewPlayer', () => {
  it('playSong で playingID が入る', () => {
    const { player } = setup()
    player.playSong(makeSong(5), 'a')
    expect(player.playingID).toBe('a')
    player.stop()
  })

  it('別の曲で入れ替わり、前の音は止まる', () => {
    const { player, log } = setup()
    player.playSong(makeSong(5), 'a')
    player.smfPlayer.tick()
    expect(log).toContainEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 100 })
    player.playSong(makeSong(5), 'b')
    expect(player.playingID).toBe('b')
    expect(log).toContainEqual({ type: 'noteOff', channel: 0, note: 60, velocity: 0 })
    player.stop()
  })

  it('stop で null になり音が残らない', () => {
    const { player, log } = setup()
    player.playSong(makeSong(5), 'a')
    player.smfPlayer.tick()
    player.stop()
    expect(player.playingID).toBeNull()
    const ons = log.filter((m) => m.type === 'noteOn').length
    const offs = log.filter((m) => m.type === 'noteOff').length
    expect(ons).toBeGreaterThan(0)
    expect(offs).toBe(ons)
  })

  it('stop で onStopped が 1 回だけ呼ばれる', () => {
    const { player } = setup()
    let count = 0
    player.onStopped = () => {
      count += 1
    }
    player.stop()
    expect(count).toBe(0) // 鳴らしていなければ呼ばない
    player.playSong(makeSong(5), 'a')
    player.stop()
    player.stop()
    expect(count).toBe(1)
  })

  it('自然に終わると playingID が null になり onStopped が 1 回だけ呼ばれる', () => {
    const { player, clock } = setup()
    let count = 0
    player.onStopped = () => {
      count += 1
    }
    player.playSong(makeSong(0.2), 'a')
    clock.advance(0.3)
    player.smfPlayer.tick()
    expect(player.playingID).toBeNull()
    clock.advance(0.3)
    player.smfPlayer.tick()
    expect(count).toBe(1)
  })

  it('世代が変わった後の要求では鳴らない', () => {
    const { player } = setup()
    const token = player.request()
    player.stop()
    expect(player.playSong(makeSong(5), 'a', token)).toBe(false)
    expect(player.playingID).toBeNull()
    // 別の再生が割り込んだ後でも鳴らない
    const token2 = player.request()
    player.playSong(makeSong(5), 'b')
    expect(player.playSong(makeSong(5), 'c', token2)).toBe(false)
    expect(player.playingID).toBe('b')
    player.stop()
  })

  it('壊れた SMF は鳴らさず false で、警告を出す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = new PreviewPlayer({
      sink: () => {},
      clock: new ManualClock(),
      usesTimer: false,
      baseUrl: '/songs/previews/',
      fetchFn: () => Promise.resolve(new Response(new Uint8Array([0, 1, 2]))),
    })
    expect(await player.play('broken')).toBe(false)
    expect(player.playingID).toBeNull()
    expect(warn).toHaveBeenCalledWith('試聴の読み込みに失敗', 'broken', expect.anything())
    warn.mockRestore()
  })

  it('取得に失敗（!ok）したら警告を出して false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = new PreviewPlayer({
      sink: () => {},
      clock: new ManualClock(),
      usesTimer: false,
      baseUrl: '/songs/previews/',
      fetchFn: () => Promise.resolve(new Response(null, { status: 404 })),
    })
    expect(await player.play('missing')).toBe(false)
    expect(player.playingID).toBeNull()
    expect(warn).toHaveBeenCalledWith('試聴の読み込みに失敗', 'missing', 404)
    warn.mockRestore()
  })

  it('世代切れでは警告を出さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { player } = setup()
    const promise = player.play('a')
    player.stop()
    expect(await promise).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('長さ 0 の曲は鳴らさず false', () => {
    const { player } = setup()
    expect(player.playSong(makeSong(0), 'empty')).toBe(false)
    expect(player.playingID).toBeNull()
  })

  it('世代が同じ要求は鳴る', () => {
    const { player } = setup()
    const token = player.request()
    expect(player.playSong(makeSong(5), 'a', token)).toBe(true)
    expect(player.playingID).toBe('a')
    player.stop()
  })

  it('subscribe で playingID の変化が届き、解除できる', () => {
    const { player } = setup()
    const seen: (string | null)[] = []
    const unsubscribe = player.subscribe((id) => seen.push(id))
    player.playSong(makeSong(5), 'a')
    player.stop()
    expect(seen).toEqual(['a', null])
    unsubscribe()
    player.playSong(makeSong(5), 'b')
    expect(seen).toEqual(['a', null])
    player.stop()
  })

  it('play(songID) は previews/<id>.mid を取って鳴らす', async () => {
    const { player, urls, log } = setup()
    expect(await player.play('bach.air')).toBe(true)
    expect(urls).toEqual(['/songs/previews/bach.air.mid'])
    expect(player.playingID).toBe('bach.air')
    player.smfPlayer.tick()
    expect(log).toContainEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 100 })
    player.stop()
  })

  it('読み込み中に別の曲を play すると、古い要求は鳴らさない', async () => {
    const { player } = setup()
    const first = player.play('a')
    const second = player.play('b')
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(player.playingID).toBe('b')
    player.stop()
  })

  it('読み込み中に stop すると鳴らさない', async () => {
    const { player } = setup()
    const pending = player.play('a')
    player.stop()
    expect(await pending).toBe(false)
    expect(player.playingID).toBeNull()
  })

  it('取得に失敗したら鳴らさず false を返す', async () => {
    const player = new PreviewPlayer({
      sink: () => {},
      usesTimer: false,
      fetchFn: () => Promise.resolve(new Response(null, { status: 404 })),
    })
    expect(await player.play('x')).toBe(false)
    expect(player.playingID).toBeNull()
  })
})
