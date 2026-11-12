// SMFPlayer のテスト。手本は SoundEngine の Tests/JPMIDIKitTests/SMFPlayerTests.swift。時計は手で進める
import { describe, expect, it } from 'vitest'
import type { SmfSong } from '../midi/smf'
import type { MidiMessage, TimedMidiEvent } from '../midi/types'
import { SmfPlayer, type PlayerClock } from './smfPlayer'

class ManualClock implements PlayerClock {
  private time = 0
  now(): number {
    return this.time
  }
  advance(seconds: number): void {
    this.time += seconds
  }
}

const on = (channel: number, note: number, velocity: number): MidiMessage => ({ type: 'noteOn', channel, note, velocity })
const off = (channel: number, note: number): MidiMessage => ({ type: 'noteOff', channel, note, velocity: 0 })
const cc = (channel: number, controller: number, value: number): MidiMessage => ({ type: 'controlChange', channel, controller, value })
const pc = (channel: number, program: number): MidiMessage => ({ type: 'programChange', channel, program })
const bend = (channel: number, value: number): MidiMessage => ({ type: 'pitchBend', channel, value })
const at = (time: number, message: MidiMessage): TimedMidiEvent => ({ time, message })

function makeSongOf(events: TimedMidiEvent[], duration: number, usedChannels: number[]): SmfSong {
  return { title: null, events, duration, usedChannels: new Set(usedChannels), initialPrograms: new Map(), trackNames: new Map() }
}

const events: TimedMidiEvent[] = [at(0.0, on(0, 60, 100)), at(0.5, on(1, 64, 90)), at(1.0, off(0, 60)), at(1.5, off(1, 64))]
const makeSong = (): SmfSong => makeSongOf(events, 2.0, [0, 1])
const messages = (list: TimedMidiEvent[]): MidiMessage[] => list.map((e) => e.message)

/** ch の無音化で送られる CC64=0・ピッチベンド中央 */
const pedalReset = (channel: number): MidiMessage[] => [cc(channel, 64, 0), bend(channel, 8192)]

function setup(song: SmfSong = makeSong()) {
  const clock = new ManualClock()
  const log: MidiMessage[] = []
  const player = new SmfPlayer((m) => log.push(m), { clock, usesTimer: false })
  player.load(song)
  const advance = (seconds: number): void => {
    clock.advance(seconds)
    player.tick()
  }
  return { player, clock, log, advance }
}

describe('SmfPlayer 再生', () => {
  it('イベントが時刻順に送られる', () => {
    const { player, log, advance } = setup()
    player.tick()
    expect(log).toEqual([])
    player.play()
    player.tick()
    expect(log).toEqual([events[0].message])
    advance(0.6)
    expect(log).toEqual([events[0].message, events[1].message])
    // 遅れた分はまとめて送る
    advance(1.0)
    expect(log).toEqual(messages(events))
    expect(player.position).toBeCloseTo(1.6, 9)
    player.stop()
  })

  it('ミュート中の NoteOn は送らない', () => {
    const { player, log, advance } = setup()
    player.mutedChannels = new Set([1])
    log.length = 0
    player.play()
    advance(1.6)
    expect(log).toEqual([events[0].message, events[2].message])
    player.stop()
  })

  it('ミュートした瞬間にその ch の音を止める', () => {
    const { player, log, advance } = setup()
    player.play()
    advance(0.6)
    log.length = 0
    player.mutedChannels = new Set([1])
    expect(log).toEqual([off(1, 64)])
    // 解除では何も送らない
    log.length = 0
    player.mutedChannels = new Set()
    expect(log).toEqual([])
    player.stop()
  })

  it('stop で鳴っている音だけ止めて位置を保つ', () => {
    const { player, log, advance } = setup()
    player.play()
    advance(0.7)
    log.length = 0
    player.stop()
    expect(player.isPlaying).toBe(false)
    expect(log.slice(0, 2)).toEqual([off(0, 60), off(1, 64)])
    expect(log).toEqual(expect.arrayContaining([...pedalReset(0), ...pedalReset(1)]))
    // noteOff 2 件 + 送った 2ch 分の（CC64=0・ベンド中央）2 件ずつ = 6
    expect(log).toHaveLength(6)
    expect(player.position).toBeCloseTo(0.7, 9)
    // 停止中は時計が進んでも送らない
    log.length = 0
    advance(5)
    expect(log).toEqual([])
    expect(player.position).toBeCloseTo(0.7, 9)
  })

  it('seek は音を止めて位置からイベントを送る', () => {
    const { player, log, advance } = setup()
    player.play()
    advance(0.1)
    log.length = 0
    player.seek(1.0)
    expect(log).toEqual([off(0, 60), ...pedalReset(0)])
    expect(player.position).toBeCloseTo(1.0, 9)
    log.length = 0
    player.tick()
    // seek 位置ちょうどのイベントから送る
    expect(log).toEqual([events[2].message])
    advance(0.5)
    expect(log).toEqual([events[2].message, events[3].message])
    // 後ろへ戻すと、また最初から送られる
    player.seek(0)
    log.length = 0
    player.tick()
    expect(log).toEqual([events[0].message])
    player.stop()
  })

  it('最後まで行くと onFinished が呼ばれ停止状態になる', () => {
    const { player, log, advance } = setup()
    let finished = 0
    player.onFinished = () => {
      finished += 1
    }
    player.play()
    advance(1.9)
    expect(player.isPlaying).toBe(true)
    expect(finished).toBe(0)
    advance(0.2)
    expect(player.isPlaying).toBe(false)
    expect(finished).toBe(1)
    expect(player.position).toBeCloseTo(2.0, 9)
    expect(log).toEqual(expect.arrayContaining([...pedalReset(0), ...pedalReset(1)]))
    advance(1)
    expect(finished).toBe(1)
    // 終わった後の再生は先頭から
    log.length = 0
    player.play()
    player.tick()
    expect(log).toEqual([events[0].message])
    player.stop()
  })

  it('何も送っていない stop・seek は何も送らない', () => {
    const { player, log } = setup()
    player.stop()
    expect(log).toEqual([])
    player.seek(0.3)
    expect(log).toEqual([])
  })

  it('停止中の seek と曲の終わりちょうどの seek で onFinished は 1 回だけ', () => {
    const { player, advance } = setup()
    let finished = 0
    player.onFinished = () => {
      finished += 1
    }
    // 停止中の seek は終了扱いにならない
    player.seek(2.0)
    player.tick()
    expect(finished).toBe(0)
    // 再生中に終わりちょうどへ seek すると 1 回だけ
    player.seek(1.0)
    player.play()
    player.seek(2.0)
    player.tick()
    advance(1)
    player.tick()
    expect(finished).toBe(1)
    expect(player.isPlaying).toBe(false)
  })

  it('再生中の load で先頭に戻り停止状態になる', () => {
    const { player, log, advance } = setup()
    player.play()
    advance(0.7)
    log.length = 0
    player.load(makeSong())
    expect(player.isPlaying).toBe(false)
    expect(player.position).toBeCloseTo(0, 9)
    expect(log).toContainEqual(off(0, 60))
    log.length = 0
    advance(1)
    expect(log).toEqual([])
    player.play()
    player.tick()
    expect(log).toEqual([events[0].message])
    player.stop()
  })

  it('弾くパートの ch は stop・seek・ミュートで触らない', () => {
    const { player, log, advance } = setup()
    player.mutedChannels = new Set([1])
    player.play()
    advance(0.6)
    log.length = 0
    player.stop()
    player.seek(0.2)
    player.mutedChannels = new Set([0, 1])
    expect(log.some((m) => m.channel === 1)).toBe(false)
    expect(log).toContainEqual(off(0, 60))
  })

  it('ミュート中の ch には曲の NoteOff も CC もピッチベンドも送らない', () => {
    const song = makeSongOf(
      [at(0.0, pc(1, 5)), at(0.1, cc(1, 64, 127)), at(0.2, bend(1, 9000)), at(0.3, off(1, 64)), at(0.4, cc(0, 7, 80))],
      1.0,
      [0, 1],
    )
    const { player, log, advance } = setup(song)
    player.mutedChannels = new Set([1])
    player.play()
    advance(0.5)
    expect(log).toEqual([cc(0, 7, 80)])
    player.stop()
  })

  it('velocity 0 の NoteOn は NoteOff として扱う', () => {
    const song = makeSongOf([at(0.0, on(0, 60, 100)), at(0.1, on(0, 60, 0))], 1.0, [0])
    const { player, log, advance } = setup(song)
    player.play()
    advance(0.2)
    expect(log).toEqual([on(0, 60, 100), on(0, 60, 0)])
    // 音は止まっているので stop で noteOff は追加されない
    log.length = 0
    player.stop()
    expect(log.some((m) => m.type === 'noteOff')).toBe(false)
  })

  it('seek は飛ばした区間の音色と CC とピッチベンドを追いかける', () => {
    const song = makeSongOf(
      [
        at(0.0, pc(0, 3)),
        at(0.1, pc(0, 4)),
        at(0.1, cc(0, 7, 100)),
        at(0.2, cc(0, 7, 90)),
        at(0.2, cc(0, 10, 20)),
        at(0.2, bend(0, 9000)),
        at(0.2, pc(1, 9)),
        at(0.8, pc(0, 99)),
      ],
      1.0,
      [0, 1],
    )
    const { player, log } = setup(song)
    player.mutedChannels = new Set([1])
    log.length = 0
    player.seek(0.5)
    expect(log).toEqual([pc(0, 4), cc(0, 7, 90), cc(0, 10, 20), bend(0, 9000)])
  })

  it('NaN への seek は無視する', () => {
    const { player, log } = setup()
    player.seek(Number.NaN)
    expect(player.position).toBeCloseTo(0, 9)
    expect(log).toEqual([])
  })
})

describe('SmfPlayer タイマー', () => {
  it('usesTimer が true なら setInterval で進み、終わると止まる', async () => {
    const log: MidiMessage[] = []
    const player = new SmfPlayer((m) => log.push(m), { intervalMs: 2 })
    player.load(makeSongOf([at(0.0, on(0, 60, 100)), at(0.05, off(0, 60))], 0.1, [0]))
    const done = new Promise<void>((resolve) => {
      player.onFinished = resolve
    })
    player.play()
    await done
    expect(player.isPlaying).toBe(false)
    expect(log.slice(0, 2)).toEqual([on(0, 60, 100), off(0, 60)])
  })

  it('play・stop・play の連打でイベントが重複しない', async () => {
    const log: MidiMessage[] = []
    const player = new SmfPlayer((m) => log.push(m), { intervalMs: 2 })
    player.load(makeSongOf([at(0.0, on(0, 60, 100)), at(0.1, on(0, 62, 100))], 0.2, [0]))
    const done = new Promise<void>((resolve) => {
      player.onFinished = resolve
    })
    for (let i = 0; i < 5; i++) {
      player.play()
      player.stop()
    }
    // stop は位置を保つので、続きから再生される。先頭から確かめるため一度戻す
    player.seek(0)
    log.length = 0
    player.play()
    await done
    expect(log.filter((m) => m.type === 'noteOn')).toEqual([on(0, 60, 100), on(0, 62, 100)])
  })
})

describe('SmfPlayer hold', () => {
  it('hold の時刻で止まり、時計を進めても位置が動かない', () => {
    const { player, log, advance } = setup()
    player.play()
    player.hold = 1.0
    player.tick()
    advance(0.6)
    expect(log).toEqual([events[0].message, events[1].message])
    expect(player.isHeld).toBe(false)
    advance(0.5)
    expect(player.isHeld).toBe(true)
    expect(player.isPlaying).toBe(true)
    expect(player.position).toBeCloseTo(1.0, 9)
    // hold ちょうどの note off は送らず、鳴っている音は伸ばしたまま
    expect(log).toEqual([events[0].message, events[1].message])
    advance(5)
    expect(player.position).toBeCloseTo(1.0, 9)
    expect(log).toEqual([events[0].message, events[1].message])
    player.stop()
  })

  it('holdReleaseDelay を過ぎると伸ばしている音を止め、続けても鳴らし直さない', () => {
    const { player, log, advance } = setup()
    player.holdReleaseDelay = 3
    player.play()
    player.hold = 1.0
    player.tick()
    advance(1.0)
    expect(player.isHeld).toBe(true)
    // 3 秒経つまでは伸ばしたまま
    advance(2.9)
    expect(log).toEqual([events[0].message, events[1].message])
    advance(0.2)
    expect(log).toEqual([events[0].message, events[1].message, off(0, 60), off(1, 64)])
    // 2 度は送らない
    advance(1)
    expect(log).toHaveLength(4)
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(1.0, 9)
    player.stop()
  })

  it('hold を先へ変えると、その呼び出しの中で hold 時刻の事象が送られる', () => {
    const { player, log, advance } = setup()
    player.play()
    player.hold = 1.0
    player.tick()
    advance(0.6)
    advance(0.5)
    advance(5)
    log.length = 0
    // tick を待たずに、この呼び出しの中で送られる
    player.hold = 1.5
    expect(log).toEqual([events[2].message])
    expect(player.isHeld).toBe(false)
    expect(player.position).toBeCloseTo(1.0, 9)
    // 止まっていた間の時間は進まない。続きは 1.0 から
    advance(0.4)
    expect(player.position).toBeCloseTo(1.4, 9)
    expect(log).toEqual([events[2].message])
    advance(0.2)
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(1.5, 9)
    // 次の hold ちょうどの事象は送らない
    expect(log).toEqual([events[2].message])
    player.stop()
  })

  it('hold を null にすると最後まで続けて終わる', () => {
    const { player, log, advance } = setup()
    let finished = 0
    player.onFinished = () => {
      finished += 1
    }
    player.play()
    player.hold = 1.0
    player.tick()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    log.length = 0
    player.hold = null
    expect(log).toEqual([events[2].message])
    expect(player.isHeld).toBe(false)
    advance(0.6)
    expect(log).toEqual([events[2].message, events[3].message])
    advance(1)
    expect(player.isPlaying).toBe(false)
    expect(finished).toBe(1)
    expect(player.position).toBeCloseTo(2.0, 9)
  })

  it('同じ時刻の複数の事象は解除の呼び出しの中でまとめて送られる', () => {
    const song = makeSongOf(
      [at(0.0, on(0, 60, 100)), at(1.0, off(0, 60)), at(1.0, on(0, 62, 100)), at(1.0, on(0, 64, 100)), at(1.5, off(0, 62))],
      2.0,
      [0],
    )
    const { player, log, advance } = setup(song)
    player.hold = 1.0
    player.play()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    expect(log).toEqual([song.events[0].message])
    log.length = 0
    player.hold = 1.5
    expect(log).toEqual([song.events[1].message, song.events[2].message, song.events[3].message])
    player.stop()
  })

  it('先頭の hold は再生を始めてすぐ止まる', () => {
    const { player, log } = setup()
    player.hold = 0
    player.play()
    player.tick()
    expect(player.isHeld).toBe(true)
    expect(log).toEqual([])
    player.hold = 0.5
    expect(log).toEqual([events[0].message])
    player.stop()
  })

  it('曲の長さ以上の hold では止まらない', () => {
    const { player, advance } = setup()
    player.hold = 2.0
    player.play()
    advance(2.5)
    expect(player.isHeld).toBe(false)
    expect(player.isPlaying).toBe(false)
  })

  it('stop で hold は消える', () => {
    const { player, log, advance } = setup()
    player.hold = 1.0
    player.play()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    log.length = 0
    player.stop()
    expect(player.isHeld).toBe(false)
    expect(player.hold).toBeNull()
    // 止めたときは鳴っている音を止める
    expect(log).toContainEqual(off(0, 60))
    expect(player.position).toBeCloseTo(1.0, 9)
    // 続きの再生は hold なしで最後まで行く
    log.length = 0
    player.play()
    advance(0.6)
    expect(player.isHeld).toBe(false)
    expect(log).toContainEqual(events[2].message)
    player.stop()
  })

  it('seek と load で hold は消える', () => {
    const { player, advance } = setup()
    player.hold = 1.0
    player.play()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    player.seek(0.2)
    expect(player.isHeld).toBe(false)
    expect(player.hold).toBeNull()
    advance(1.5)
    expect(player.position).toBeCloseTo(1.7, 9)
    player.hold = 1.8
    advance(0.5)
    expect(player.isHeld).toBe(true)
    player.load(makeSong())
    expect(player.isHeld).toBe(false)
    expect(player.hold).toBeNull()
  })

  it('停止中に設定した hold は再生で効く', () => {
    const { player, advance } = setup()
    player.hold = 0.5
    expect(player.hold).toBe(0.5)
    expect(player.isHeld).toBe(false)
    player.play()
    advance(1)
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(0.5, 9)
    player.stop()
  })

  it('負と非有限の hold は無視する', () => {
    const { player, advance } = setup()
    player.hold = -1
    expect(player.hold).toBeNull()
    player.hold = 1.0
    player.hold = -0.5
    player.hold = Number.NaN
    player.hold = Number.NEGATIVE_INFINITY
    player.hold = Number.POSITIVE_INFINITY
    expect(player.hold).toBe(1.0)
    player.play()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(1.0, 9)
    player.stop()
  })

  it('止まっている間に現在位置以下へ変えても位置は戻らず止まったまま', () => {
    const { player, log, advance } = setup()
    player.play()
    player.hold = 1.0
    player.tick()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    const sent = [...log]
    player.hold = 0.5
    expect(player.hold).toBe(0.5)
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(1.0, 9)
    advance(1)
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(1.0, 9)
    expect(log).toEqual(sent)
    // 同じ位置（現在位置と同じ値）でも止まったまま
    player.hold = 1.0
    expect(player.isHeld).toBe(true)
    expect(log).toEqual(sent)
    player.stop()
  })

  it('同じ値で hold を設定し直しても何も起きない', () => {
    const { player, log, advance } = setup()
    player.play()
    player.hold = 1.0
    player.tick()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    const sent = [...log]
    player.hold = 1.0
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(1.0, 9)
    expect(log).toEqual(sent)
    player.stop()
  })

  it('再生中に現在位置より前へ変えると、次の tick でその時刻へ戻って止まる', () => {
    const { player, log, clock } = setup()
    player.play()
    clock.advance(1.2)
    player.tick()
    expect(player.position).toBeCloseTo(1.2, 9)
    const sent = [...log]
    player.hold = 0.8
    expect(player.isHeld).toBe(false)
    expect(player.position).toBeCloseTo(1.2, 9)
    player.tick()
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(0.8, 9)
    // 送った事象は取り消さず、新しく送りもしない
    expect(log).toEqual(sent)
    player.stop()
  })

  it('ミュートと組み合わせても動く', () => {
    const { player, log, advance } = setup()
    // ch1 を弾くパートとして鳴らさない
    player.mutedChannels = new Set([1])
    log.length = 0
    player.hold = 1.0
    player.play()
    advance(1.2)
    expect(player.isHeld).toBe(true)
    expect(log).toEqual([events[0].message])
    player.hold = 2.0
    expect(log).toEqual([events[0].message, events[2].message])
    player.stop()
  })
})
