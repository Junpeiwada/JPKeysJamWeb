import { describe, it, expect, vi } from 'vitest'
import {
  parseMidiBytes,
  WebMidiInput,
  type MidiAccessLike,
  type MidiInputLike,
} from './webMidi'
import type { MidiMessage } from './types'

const bytes = (...b: number[]) => new Uint8Array(b)

describe('parseMidiBytes', () => {
  it('Note On / Off を読む', () => {
    expect(parseMidiBytes(bytes(0x90, 60, 100))).toEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 100 })
    expect(parseMidiBytes(bytes(0x83, 61, 20))).toEqual({ type: 'noteOff', channel: 3, note: 61, velocity: 20 })
  })
  it('ベロシティ 0 の Note On は noteOff', () => {
    expect(parseMidiBytes(bytes(0x91, 60, 0))).toEqual({ type: 'noteOff', channel: 1, note: 60, velocity: 0 })
  })
  it('CC は全部通す', () => {
    expect(parseMidiBytes(bytes(0xb0, 64, 127))).toEqual({ type: 'controlChange', channel: 0, controller: 64, value: 127 })
    expect(parseMidiBytes(bytes(0xb2, 1, 5))).toEqual({ type: 'controlChange', channel: 2, controller: 1, value: 5 })
  })
  it('ピッチベンドは 14 ビット（LSB が先）', () => {
    expect(parseMidiBytes(bytes(0xe0, 0x00, 0x40))).toEqual({ type: 'pitchBend', channel: 0, value: 8192 })
    expect(parseMidiBytes(bytes(0xe5, 0x7f, 0x7f))).toEqual({ type: 'pitchBend', channel: 5, value: 16383 })
    expect(parseMidiBytes(bytes(0xe0, 0x00, 0x00))).toEqual({ type: 'pitchBend', channel: 0, value: 0 })
  })
  it('プログラムチェンジを読む', () => {
    expect(parseMidiBytes(bytes(0xc1, 5))).toEqual({ type: 'programChange', channel: 1, program: 5 })
  })
  it('システムメッセージ・クロック・アクティブセンシング・空・途中切れは null', () => {
    expect(parseMidiBytes(bytes(0xf8))).toBeNull()
    expect(parseMidiBytes(bytes(0xfe))).toBeNull()
    expect(parseMidiBytes(bytes(0xf0, 1, 2, 0xf7))).toBeNull()
    expect(parseMidiBytes(bytes())).toBeNull()
    expect(parseMidiBytes(bytes(0x90, 60))).toBeNull()
    expect(parseMidiBytes(bytes(0x40, 60, 1))).toBeNull()
    expect(parseMidiBytes(bytes(0xd0, 10))).toBeNull()
  })
})

// 偽の MIDIAccess
function makeInput(id: string, name = id): MidiInputLike {
  return { id, name, manufacturer: 'M', type: 'input', state: 'connected', onmidimessage: null }
}
function makeAccess(initial: MidiInputLike[]) {
  const list = [...initial]
  const access: MidiAccessLike = {
    inputs: { values: () => list.values() },
    onstatechange: null,
  }
  return {
    access,
    add(input: MidiInputLike) {
      list.push(input)
      access.onstatechange?.({})
    },
    /** Chromium のように inputs に残したまま state だけ変える */
    disconnect(input: MidiInputLike) {
      input.state = 'disconnected'
      access.onstatechange?.({})
    },
    remove(input: MidiInputLike) {
      list.splice(list.indexOf(input), 1)
      access.onstatechange?.({})
    },
  }
}

describe('WebMidiInput', () => {
  it('対応していない環境（node）では unsupported', async () => {
    const midi = new WebMidiInput()
    expect(WebMidiInput.isSupported()).toBe(false)
    expect(await midi.start()).toBe('unsupported')
    expect(midi.devices()).toEqual([])
  })

  it('許可されないと denied、それ以外の失敗は failed', async () => {
    const named = (name: string) => Object.assign(new Error(name), { name })
    expect(await new WebMidiInput(() => Promise.reject(named('SecurityError'))).start()).toBe('denied')
    expect(await new WebMidiInput(() => Promise.reject(named('NotAllowedError'))).start()).toBe('denied')
    expect(await new WebMidiInput(() => Promise.reject(new Error('x'))).start()).toBe('failed')
  })

  it('start 中に stop すると、あとで解決してもハンドラを付けず stopped', async () => {
    const a = makeInput('a')
    const fake = makeAccess([a])
    let resolve!: (v: MidiAccessLike) => void
    const midi = new WebMidiInput(() => new Promise<MidiAccessLike>((r) => (resolve = r)))
    const started = midi.start()
    midi.stop()
    resolve(fake.access)
    expect(await started).toBe('stopped')
    expect(fake.access.onstatechange).toBeNull()
    expect(a.onmidimessage).toBeNull()
    expect(midi.devices()).toEqual([])
  })

  it('start を 2 回呼んでも request は 1 回', async () => {
    const fake = makeAccess([makeInput('a')])
    const request = vi.fn(async () => fake.access)
    const midi = new WebMidiInput(request)
    const [r1, r2] = await Promise.all([midi.start(), midi.start()])
    expect([r1, r2]).toEqual(['ok', 'ok'])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('start → stop → start（StrictMode）で 2 回目が有効になる', async () => {
    const fake = makeAccess([makeInput('a')])
    const midi = new WebMidiInput(async () => fake.access)
    const first = midi.start()
    midi.stop()
    const second = midi.start()
    expect(await first).toBe('stopped')
    expect(await second).toBe('ok')
    expect(midi.devices()).toHaveLength(1)
  })

  it('抜いても inputs に残り state だけ disconnected になる場合', async () => {
    const a = makeInput('a', 'Key13')
    const b = makeInput('b', 'Other')
    const fake = makeAccess([a, b])
    const midi = new WebMidiInput(async () => fake.access)
    await midi.start()
    expect(midi.connectedDeviceNames()).toEqual(['Key13', 'Other'])

    fake.disconnect(a)
    expect(midi.devices().map((d) => d.connected)).toEqual([false, true])
    expect(midi.connectedDeviceNames()).toEqual(['Other'])

    // 切れた入力に onmidimessage が付いたままでも害はない（届かないだけ）
    const got: string[] = []
    midi.onMessage((_m, id) => got.push(id))
    b.onmidimessage?.({ data: bytes(0x90, 60, 90) })
    expect(got).toEqual(['b'])
  })

  it('購読者が例外を投げても残りに届く', async () => {
    const a = makeInput('a')
    const fake = makeAccess([a])
    const midi = new WebMidiInput(async () => fake.access)
    await midi.start()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got: string[] = []
    midi.onMessage(() => {
      throw new Error('boom')
    })
    midi.onMessage((_m, id) => got.push(id))
    midi.onDevicesChange(() => {
      throw new Error('boom')
    })
    const changes: number[] = []
    midi.onDevicesChange((d) => changes.push(d.length))
    a.onmidimessage?.({ data: bytes(0x90, 60, 90) })
    fake.add(makeInput('b'))
    expect(got).toEqual(['a'])
    expect(changes).toEqual([2])
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('機器の一覧とメッセージの配送', async () => {
    const a = makeInput('a', 'Key13')
    const fake = makeAccess([a])
    const midi = new WebMidiInput(async () => fake.access)
    expect(await midi.start()).toBe('ok')
    expect(midi.devices()).toEqual([{ id: 'a', name: 'Key13', manufacturer: 'M', connected: true }])

    const got: [MidiMessage, string][] = []
    midi.onMessage((m, id) => got.push([m, id]))
    a.onmidimessage?.({ data: bytes(0x90, 60, 90) })
    a.onmidimessage?.({ data: bytes(0xf8) })
    expect(got).toEqual([[{ type: 'noteOn', channel: 0, note: 60, velocity: 90 }, 'a']])
  })

  it('抜き差しで新しい入力に付け、外れた入力から外す', async () => {
    const a = makeInput('a')
    const fake = makeAccess([a])
    const midi = new WebMidiInput(async () => fake.access)
    await midi.start()
    const changes: number[] = []
    midi.onDevicesChange((d) => changes.push(d.length))
    const got: string[] = []
    midi.onMessage((_m, id) => got.push(id))

    const b = makeInput('b')
    fake.add(b)
    b.onmidimessage?.({ data: bytes(0x90, 60, 90) })
    expect(changes).toEqual([2])

    fake.remove(a)
    expect(a.onmidimessage).toBeNull()
    expect(changes).toEqual([2, 1])
    expect(got).toEqual(['b'])
  })

  it('購読を解除すると届かない', async () => {
    const a = makeInput('a')
    const fake = makeAccess([a])
    const midi = new WebMidiInput(async () => fake.access)
    await midi.start()
    let count = 0
    const off = midi.onMessage(() => count++)
    a.onmidimessage?.({ data: bytes(0x90, 60, 90) })
    off()
    a.onmidimessage?.({ data: bytes(0x90, 60, 90) })
    expect(count).toBe(1)
  })

  it('stop で全部外れる', async () => {
    const a = makeInput('a')
    const fake = makeAccess([a])
    const midi = new WebMidiInput(async () => fake.access)
    await midi.start()
    midi.stop()
    expect(a.onmidimessage).toBeNull()
    expect(fake.access.onstatechange).toBeNull()
    expect(midi.devices()).toEqual([])
  })
})
