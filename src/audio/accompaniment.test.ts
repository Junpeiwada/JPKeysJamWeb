import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEYS13, KEYS25 } from '../guide/keyRange'
import type { SmfSong } from '../midi/smf'
import type { MidiMessage, TimedMidiEvent } from '../midi/types'
import { GuideController } from './accompaniment'
import type { AccompanimentOutput, GuideControllerOptions } from './accompaniment'
import type { PlayerClock } from './smfPlayer'

/** 手動で進める時計 */
class ManualClock implements PlayerClock {
  private time = 0
  now(): number {
    return this.time
  }
  advance(by: number): void {
    this.time += by
  }
}

/** 送られたものを記録する偽の音源 */
class FakeOutput implements AccompanimentOutput {
  sent: MidiMessage[] = []
  allOff: (number | undefined)[] = []
  resets = 0
  send(message: MidiMessage): void {
    this.sent.push(message)
  }
  allNotesOff(channel?: number): void {
    this.allOff.push(channel)
  }
  resetChannels(): void {
    this.resets += 1
  }
}

const noteOn = (time: number, channel: number, note: number): TimedMidiEvent => ({
  time,
  message: { type: 'noteOn', channel, note, velocity: 100 },
})
const noteOff = (time: number, channel: number, note: number): TimedMidiEvent => ({
  time,
  message: { type: 'noteOff', channel, note, velocity: 0 },
})
const raw = (time: number, message: MidiMessage): TimedMidiEvent => ({ time, message })

/** 右手（ch1）C4・E4、左手（ch2）C3・E3。ch3 に伴奏の音と、捨てるはずの Program Change・CC */
function makeSong(): SmfSong {
  const events = [
    raw(0, { type: 'programChange', channel: 0, program: 5 }),
    raw(0, { type: 'controlChange', channel: 1, controller: 7, value: 50 }),
    // 右手（ch1）は弾く人が鳴らすので伴奏ではミュートされる。届く CC の確認には伴奏側の ch2 を使う
    raw(0, { type: 'controlChange', channel: 1, controller: 64, value: 127 }),
    noteOn(0.1, 2, 72),
    noteOff(0.2, 2, 72),
    noteOn(0.5, 0, 60),
    noteOff(0.9, 0, 60),
    noteOn(0.5, 1, 48),
    noteOff(0.9, 1, 48),
    noteOn(1.0, 0, 64),
    noteOff(1.4, 0, 64),
    noteOn(1.0, 1, 52),
    noteOff(1.4, 1, 52),
  ]
  return {
    title: null,
    events: events.sort((a, b) => a.time - b.time),
    duration: 3,
    usedChannels: new Set([0, 1, 2]),
    initialPrograms: new Map(),
    trackNames: new Map(),
  }
}

let clock: ManualClock
let output: FakeOutput

beforeEach(() => {
  clock = new ManualClock()
  output = new FakeOutput()
})

afterEach(() => {
  vi.useRealTimers()
})

function make(options: Partial<GuideControllerOptions> = {}): GuideController {
  return new GuideController({
    song: makeSong(),
    hands: 'rightOnly',
    keyRange: KEYS25,
    oneNote: false,
    output,
    clock,
    usesTimer: false,
    ...options,
  })
}

/** 時計を進めて伴奏を 1 回進める */
function advance(controller: GuideController, seconds: number): void {
  clock.advance(seconds)
  controller.player.tick()
}

const has = (type: string, channel: number, note: number): boolean =>
  output.sent.some((m) => m.type === type && m.channel === channel && 'note' in m && m.note === note)

describe('GuideController', () => {
  it('伴奏の Program Change と指定の CC は捨て、noteOn は音源へ届く', () => {
    const controller = make()
    controller.start()
    advance(controller, 0.3)
    expect(output.sent.some((m) => m.type === 'programChange')).toBe(false)
    expect(output.sent.some((m) => m.type === 'controlChange' && m.controller === 7)).toBe(false)
    // 捨てない CC と ch3 の noteOn は届く
    expect(output.sent.some((m) => m.type === 'controlChange' && m.controller === 64)).toBe(true)
    expect(has('noteOn', 2, 72)).toBe(true)
  })

  it('右手だけで正しい音名を入れると、楽譜の高さの音が ch1 で鳴りステップが進む', () => {
    const controller = make()
    controller.start()
    advance(controller, 0.5)
    output.sent = []
    controller.handleInput({ type: 'noteOn', channel: 0, note: 72, velocity: 90 })
    // 弾いた音は ch1 に楽譜の高さ（60）で 1 つだけ。ほかに届くのは、ステップが進んで鳴り出す伴奏（左手 ch2 の 48）だけ
    expect(output.sent.filter((m) => m.channel === 0)).toEqual([{ type: 'noteOn', channel: 0, note: 60, velocity: 90 }])
    expect(output.sent.filter((m) => m.channel !== 0)).toEqual([{ type: 'noteOn', channel: 1, note: 48, velocity: 100 }])
    expect(controller.guide.snapshot().stepIndex).toBe(1)
  })

  it('両手・25 鍵で C4 未満の入力は ch2 で鳴る', () => {
    const controller = make({ hands: 'both' })
    controller.start()
    advance(controller, 0.5)
    output.sent = []
    controller.handleInput({ type: 'noteOn', channel: 0, note: 48, velocity: 100 })
    expect(has('noteOn', 1, 48)).toBe(true)
    expect(output.sent.some((m) => m.channel === 0)).toBe(false)
  })

  it('noteOff で同じ音が止まる', () => {
    const controller = make()
    controller.start()
    advance(controller, 0.5)
    controller.handleInput({ type: 'noteOn', channel: 0, note: 72, velocity: 100 })
    output.sent = []
    controller.handleInput({ type: 'noteOff', channel: 0, note: 72, velocity: 0 })
    expect(output.sent).toEqual([{ type: 'noteOff', channel: 0, note: 60, velocity: 0 }])
  })

  it('CC123 で guide の表が空になる', () => {
    const controller = make()
    controller.start()
    advance(controller, 0.5)
    controller.handleInput({ type: 'noteOn', channel: 0, note: 72, velocity: 100 })
    output.allOff = []
    controller.handleInput({ type: 'controlChange', channel: 0, controller: 123, value: 0 })
    expect(output.allOff).toEqual([0, 1])
    // 表が空なので、離した鍵はそのまま（楽譜の高さに差し替えない）止める
    output.sent = []
    controller.handleInput({ type: 'noteOff', channel: 0, note: 72, velocity: 0 })
    expect(output.sent).toEqual([{ type: 'noteOff', channel: 0, note: 72, velocity: 0 }])
  })

  it('手を切り替えると CC64=0 とピッチベンド中央が ch1・ch2 に送られる', () => {
    const controller = make()
    controller.start()
    output.sent = []
    controller.setHands('leftOnly')
    for (const channel of [0, 1]) {
      expect(output.sent).toContainEqual({ type: 'controlChange', channel, controller: 64, value: 0 })
      expect(output.sent).toContainEqual({ type: 'pitchBend', channel, value: 8192 })
    }
  })

  it('13 鍵では両手にしても右手のまま。手が変わらなければ戻しを送らない', () => {
    const controller = make({ keyRange: KEYS13 })
    controller.start()
    output.sent = []
    controller.setHands('both')
    expect(output.sent).toEqual([])
  })

  it('dispose でタイマーが止まる', () => {
    vi.useFakeTimers()
    const controller = make({ usesTimer: true })
    controller.start()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start・restart では押した鍵の表を空にせず、離すと押したときの ch と音で noteOff が出る', () => {
    const controller = make()
    controller.start()
    advance(controller, 0.5)
    controller.handleInput({ type: 'noteOn', channel: 0, note: 72, velocity: 100 })
    output.allOff = []
    controller.restart()
    expect(output.allOff).toEqual([0, 1])
    output.sent = []
    controller.handleInput({ type: 'noteOff', channel: 0, note: 72, velocity: 0 })
    expect(output.sent).toEqual([{ type: 'noteOff', channel: 0, note: 60, velocity: 0 }])
  })

  it('押したまま setHands で手が変わっても、noteOff は押したときの ch へ届く', () => {
    const controller = make({ hands: 'both' })
    controller.start()
    advance(controller, 0.5)
    controller.handleInput({ type: 'noteOn', channel: 0, note: 48, velocity: 100 })
    expect(has('noteOn', 1, 48)).toBe(true)
    controller.setHands('rightOnly')
    output.sent = []
    controller.handleInput({ type: 'noteOff', channel: 0, note: 48, velocity: 0 })
    const offs = output.sent.filter((m) => m.type === 'noteOff')
    expect(offs.length).toBeGreaterThan(0)
    expect(offs.every((m) => m.channel === 1)).toBe(true)
  })

  it('両手のとき CC64 とピッチベンドが ch1・ch2 の両方へ行く', () => {
    const controller = make({ hands: 'both' })
    controller.start()
    output.sent = []
    controller.handleInput({ type: 'controlChange', channel: 0, controller: 64, value: 127 })
    controller.handleInput({ type: 'pitchBend', channel: 0, value: 9000 })
    for (const channel of [0, 1]) {
      expect(output.sent).toContainEqual({ type: 'controlChange', channel, controller: 64, value: 127 })
      expect(output.sent).toContainEqual({ type: 'pitchBend', channel, value: 9000 })
    }
  })

  it('velocity 0 の noteOn は noteOff として扱う', () => {
    const controller = make()
    controller.start()
    advance(controller, 0.5)
    controller.handleInput({ type: 'noteOn', channel: 0, note: 72, velocity: 100 })
    output.sent = []
    controller.handleInput({ type: 'noteOn', channel: 0, note: 72, velocity: 0 })
    expect(output.sent).toEqual([{ type: 'noteOff', channel: 0, note: 60, velocity: 0 }])
  })

  it('右手だけのとき、伴奏の ch1（右手）は鳴らない（ミュート）', () => {
    const controller = make()
    controller.start()
    advance(controller, 3)
    expect(output.sent.some((m) => m.type === 'noteOn' && m.channel === 0)).toBe(false)
  })

  it('25 鍵・両手で右手と左手の鍵が同じ高さに差し替えられても、離した鍵の手の ch へ noteOff が出る', () => {
    // ch1・ch2 とも 0.5 秒に 60 がある曲
    const events = [noteOn(0.5, 0, 60), noteOff(0.9, 0, 60), noteOn(0.5, 1, 60), noteOff(0.9, 1, 60)]
    const song: SmfSong = {
      title: null,
      events: events.sort((a, b) => a.time - b.time),
      duration: 2,
      usedChannels: new Set([0, 1]),
      initialPrograms: new Map(),
      trackNames: new Map(),
    }
    const controller = make({ song, hands: 'both' })
    controller.start()
    advance(controller, 0.5)
    // 右手の鍵（C5 = 72）と左手の鍵（C3 = 48）を押す。どちらも楽譜の高さ 60 に差し替わる
    controller.handleInput({ type: 'noteOn', channel: 0, note: 72, velocity: 100 })
    controller.handleInput({ type: 'noteOn', channel: 0, note: 48, velocity: 100 })
    expect(has('noteOn', 0, 60)).toBe(true)
    expect(has('noteOn', 1, 60)).toBe(true)
    output.sent = []
    controller.handleInput({ type: 'noteOff', channel: 0, note: 72, velocity: 0 })
    expect(output.sent).toEqual([{ type: 'noteOff', channel: 0, note: 60, velocity: 0 }])
    output.sent = []
    controller.handleInput({ type: 'noteOff', channel: 0, note: 48, velocity: 0 })
    expect(output.sent).toEqual([{ type: 'noteOff', channel: 1, note: 60, velocity: 0 }])
  })
})
