// 手本: Tests/GuideSessionTests.swift。13 鍵×2（byChannel・送り先 ch・routing）とスレッドのケースは移していない。
import { beforeEach, describe, expect, it } from 'vitest'
import { SmfPlayer } from '../audio/smfPlayer'
import type { PlayerClock } from '../audio/smfPlayer'
import type { SmfSong } from '../midi/smf'
import type { MidiMessage, TimedMidiEvent } from '../midi/types'
import { GuideScore } from './guideScore'
import { GuidePacing, GuideSession, wrongHeldNotesOf } from './guideSession'
import type { GuideSessionOptions } from './guideSession'
import type { HandSplit, PlayHands } from './hand'

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

let clock: ManualClock
let log: MidiMessage[]

beforeEach(() => {
  clock = new ManualClock()
  log = []
})

const noteOn = (time: number, channel: number, note: number, velocity = 100): TimedMidiEvent => ({
  time,
  message: { type: 'noteOn', channel, note, velocity },
})
const noteOff = (time: number, channel: number, note: number): TimedMidiEvent => ({
  time,
  message: { type: 'noteOff', channel, note, velocity: 0 },
})
const makeSmf = (events: TimedMidiEvent[], duration: number, usedChannels: number[]): SmfSong => ({
  title: null,
  events: [...events].sort((a, b) => a.time - b.time),
  duration,
  usedChannels: new Set(usedChannels),
  initialPrograms: new Map(),
  trackNames: new Map(),
})

/** 送ったイベントに、その種類・ch・ノートがあるか */
const logHas = (type: 'noteOn' | 'noteOff', channel: number, note: number): boolean =>
  log.some((m) => m.type === type && m.channel === channel && 'note' in m && m.note === note)

/** ステップ: 0.5 秒に C、1.0 秒に E、1.5 秒に C+E+G の和音。ch1 には伴奏の音 */
function makeSong(): SmfSong {
  return makeSmf(
    [
      noteOn(0.5, 0, 60), noteOff(0.9, 0, 60),
      noteOn(1.0, 0, 64), noteOff(1.4, 0, 64),
      noteOn(1.5, 0, 60), noteOff(1.9, 0, 60),
      noteOn(1.5, 0, 64), noteOff(1.9, 0, 64),
      noteOn(1.5, 0, 67), noteOff(1.9, 0, 67),
      noteOn(0.2, 1, 40, 80), noteOff(1.2, 1, 40),
      noteOn(0.6, 2, 45, 70), noteOff(0.7, 2, 45),
    ],
    3.0,
    [0, 1, 2],
  )
}

/** 弾くパート（ch1）の音が 1 つも無い曲（ステップ 0） */
function makeEmptyStepSong(): SmfSong {
  return makeSmf([noteOn(0.2, 1, 40, 80), noteOff(1.2, 1, 40)], 3.0, [1])
}

function makePlayer(): SmfPlayer {
  return new SmfPlayer((m) => log.push(m), { clock, usesTimer: false })
}

/** 楽譜を直接渡す（右手だけ・手を分けない）セッション */
function makeSession(song: SmfSong = makeSong(), pacing: GuidePacing = GuidePacing.off): [GuideSession, SmfPlayer] {
  const player = makePlayer()
  const session = new GuideSession(song, player, { score: new GuideScore(song), clock, pacing })
  return [session, player]
}

/** 押した（判定して鳴らす音を返す）。ch は 0 */
function press(session: GuideSession, ...notes: number[]): void {
  for (const n of notes) session.voiced(0, n)
}
function release(session: GuideSession, ...notes: number[]): void {
  for (const n of notes) session.released(0, n)
}

describe('GuideSession 基本', () => {
  it('開始で最初のステップの時刻に hold が入る', () => {
    const [session, player] = makeSession()
    session.start()
    expect(player.hold).toBe(0.5)
    expect(player.mutedChannels).toEqual(new Set([0]))
    expect(session.snapshot().stepIndex).toBe(0)
    expect(session.snapshot().stepCount).toBe(3)
  })

  it('伴奏は hold で止まり弾くパートは鳴らない', () => {
    const [session, player] = makeSession()
    session.start()
    clock.advance(2.0)
    player.tick()
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(0.5, 9)
    expect(log.length).toBe(1)
    expect(logHas('noteOn', 1, 40)).toBe(true)
  })

  it('正しい音名で進み hold が次のステップの時刻になる', () => {
    const [session, player] = makeSession()
    session.start()
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(1)
    expect(player.hold).toBe(1.0)
  })

  it('オクターブ違いでも進む', () => {
    const [session, player] = makeSession()
    session.start()
    press(session, 72)
    expect(session.snapshot().stepIndex).toBe(1)
    expect(player.hold).toBe(1.0)
  })

  it('違う鍵は回数が増えるだけで進まない', () => {
    const [session, player] = makeSession()
    session.start()
    press(session, 61, 62)
    let snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.wrongCount).toBe(2)
    expect(snapshot.wrongHeldNotes).toEqual(new Set([61, 62]))
    expect(player.hold).toBe(0.5)
    release(session, 61)
    snapshot = session.snapshot()
    expect(snapshot.wrongCount).toBe(2)
    expect(snapshot.wrongHeldNotes).toEqual(new Set([62]))
  })

  it('高い鍵の違う鍵も数える', () => {
    const [session] = makeSession()
    session.start()
    press(session, 100)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set([100]))
    release(session, 100)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set())
  })

  it('和音は全部そろうまで進まず順不同で離した音も数える', () => {
    const [session, player] = makeSession()
    session.start()
    press(session, 60)
    press(session, 64)
    expect(session.snapshot().stepIndex).toBe(2)
    expect(player.hold).toBe(1.5)
    press(session, 79) // G（オクターブ違い）
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().collectedPitchClasses).toEqual(new Set([7]))
    release(session, 79)
    press(session, 64)
    expect(session.snapshot().stepIndex).toBe(2)
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(3)
  })

  it('最後のステップで hold が null になる', () => {
    const [session, player] = makeSession()
    session.start()
    press(session, 60)
    press(session, 64)
    press(session, 67, 64, 60)
    expect(session.snapshot().isFinished).toBe(true)
    expect(player.hold).toBeNull()
  })

  it('進めると伴奏が次のステップまで鳴る', () => {
    const [session, player] = makeSession()
    session.start()
    clock.advance(2.0)
    player.tick()
    expect(logHas('noteOn', 2, 45)).toBe(false)
    press(session, 60)
    clock.advance(2.0)
    player.tick()
    expect(player.position).toBeCloseTo(1.0, 9)
    expect(player.isHeld).toBe(true)
    expect(logHas('noteOn', 2, 45)).toBe(true)
    expect(logHas('noteOff', 1, 40)).toBe(false)
  })

  it('経過時間は弾き終えると止まる', () => {
    const [session] = makeSession()
    session.start()
    clock.advance(1.0)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 3)
    press(session, 60)
    press(session, 64)
    press(session, 60, 64, 67)
    clock.advance(5.0)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 3)
  })

  it('最初からで状態が戻る', () => {
    const [session, player] = makeSession()
    session.start()
    press(session, 60, 61)
    session.restart()
    const snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.wrongCount).toBe(0)
    expect(player.hold).toBe(0.5)
  })

  it('止めた後の入力は進まない', () => {
    const [session] = makeSession()
    session.start()
    session.stop()
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(0)
  })

  it('どの ch の入力も受ける', () => {
    const [session] = makeSession()
    session.start()
    session.voiced(9, 60)
    expect(session.snapshot().stepIndex).toBe(1)
  })

  it('ベロシティ 0 の noteOn（released）で違う鍵の表示が消える', () => {
    const [session] = makeSession()
    session.start()
    press(session, 61)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set([61]))
    session.released(0, 61)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set())
    expect(session.snapshot().wrongCount).toBe(1)
  })

  it('弾き終えた後の違う鍵は回数に入らない', () => {
    const [session] = makeSession()
    session.start()
    press(session, 60)
    press(session, 64)
    press(session, 60, 64, 67)
    press(session, 61)
    const snapshot = session.snapshot()
    expect(snapshot.isFinished).toBe(true)
    expect(snapshot.wrongCount).toBe(0)
    expect(snapshot.wrongHeldNotes).toEqual(new Set())
  })

  it('stop で経過時間が止まる', () => {
    const [session] = makeSession()
    session.start()
    clock.advance(1.0)
    session.stop()
    clock.advance(5.0)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 3)
  })

  it('ステップ 0 の曲は start で hold が null になり弾き終えた扱いになる', () => {
    const [session, player] = makeSession(makeEmptyStepSong())
    session.start()
    expect(player.hold).toBeNull()
    expect(session.snapshot().stepCount).toBe(0)
    expect(session.snapshot().isFinished).toBe(true)
  })

  it('start 前の snapshot は経過 0 で弾き終えていない', () => {
    clock.advance(3.0)
    for (const song of [makeSong(), makeEmptyStepSong()]) {
      const [session] = makeSession(song)
      const snapshot = session.snapshot()
      expect(snapshot.elapsed).toBe(0)
      expect(snapshot.isFinished).toBe(false)
    }
  })
})

function playAllSteps(session: GuideSession): void {
  press(session, 60)
  press(session, 64)
  press(session, 60, 64, 67)
}

describe('GuideSession 完了', () => {
  it('最後のステップのあとは伴奏が終わるまで完了にならない', () => {
    const [session, player] = makeSession()
    session.start()
    playAllSteps(session)
    expect(session.snapshot().isFinished).toBe(true)
    expect(session.snapshot().isComplete).toBe(false)
    clock.advance(1.0)
    player.tick()
    expect(session.snapshot().isComplete).toBe(false)
    expect(player.isPlaying).toBe(true)
  })

  it('伴奏が最後まで鳴ると完了になり経過時間は変わらない', () => {
    const [session, player] = makeSession()
    session.start()
    clock.advance(1.0)
    playAllSteps(session)
    clock.advance(5.0)
    player.tick()
    const snapshot = session.snapshot()
    expect(snapshot.isComplete).toBe(true)
    expect(snapshot.elapsed).toBeCloseTo(1.0, 3)
  })

  it('最初からで完了が戻る', () => {
    const [session, player] = makeSession()
    session.start()
    playAllSteps(session)
    clock.advance(5.0)
    player.tick()
    expect(session.snapshot().isComplete).toBe(true)
    session.restart()
    expect(session.snapshot().isComplete).toBe(false)
    expect(player.hold).toBe(0.5)
  })

  it('最初からのあとに古い onFinished が届いても完了にならない', () => {
    const [session, player] = makeSession()
    session.start()
    playAllSteps(session)
    session.restart()
    player.onFinished?.()
    expect(session.snapshot().isComplete).toBe(false)
  })

  it('曲の長さちょうどのステップでも hold が有効で弾いたあと完了になる', () => {
    const song = makeSmf([noteOn(3.0, 0, 60), noteOff(3.0, 0, 60), noteOn(0.2, 1, 40, 80)], 3.0, [0, 1])
    const [session, player] = makeSession(song)
    session.start()
    expect(player.hold).not.toBeNull()
    expect(player.hold ?? 99).toBeLessThan(3.0)
    clock.advance(10.0)
    player.tick()
    expect(player.isHeld).toBe(true)
    expect(session.snapshot().isComplete).toBe(false)
    press(session, 60)
    clock.advance(1.0)
    player.tick()
    expect(session.snapshot().isComplete).toBe(true)
    session.pause()
    session.resume()
    expect(player.isPlaying).toBe(false)
  })
})

describe('GuideSession seek', () => {
  it('seek で前のステップに戻り伴奏もその時刻で止まる', () => {
    const [session, player] = makeSession()
    session.start()
    press(session, 61)
    press(session, 60)
    press(session, 64)
    press(session, 67) // 3 つめのステップの G だけ集める
    session.seek(0)
    const snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.collectedPitchClasses).toEqual(new Set())
    expect(snapshot.wrongCount).toBe(1) // 違う鍵の回数は保つ
    expect(player.hold).toBe(0.5)
    expect(player.position).toBeCloseTo(0.5, 9)
    expect(player.isPlaying).toBe(true)
    // 戻った先のステップを弾くと、次のステップへ進む
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(1)
    expect(player.hold).toBe(1.0)
  })

  it('seek で先のステップへ進むとその時刻の伴奏は弾くまで鳴らない', () => {
    const [session, player] = makeSession()
    session.start()
    session.seek(1)
    clock.advance(2.0)
    player.tick()
    expect(session.snapshot().stepIndex).toBe(1)
    expect(player.isHeld).toBe(true)
    expect(player.position).toBeCloseTo(1.0, 9)
    expect(logHas('noteOff', 1, 40)).toBe(false) // 1.2 秒の伴奏は弾くまで送らない
    press(session, 64)
    clock.advance(2.0)
    player.tick()
    expect(logHas('noteOff', 1, 40)).toBe(true)
  })

  it('seek は最後のステップまでに丸め弾き終えた扱いにしない', () => {
    const [session, player] = makeSession()
    session.start()
    session.seek(99)
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().isFinished).toBe(false)
    expect(player.hold).toBe(1.5)
    session.seek(-3)
    expect(session.snapshot().stepIndex).toBe(0)
  })

  it('弾き終えたあとの伴奏中に seek で戻ると経過時間が止まっていた分を数えず進む', () => {
    const [session, player] = makeSession()
    session.start()
    clock.advance(1.0)
    playAllSteps(session)
    clock.advance(0.5)
    session.seek(1)
    expect(session.snapshot().isFinished).toBe(false)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 3)
    expect(player.hold).toBe(1.0)
    expect(player.isPlaying).toBe(true)
    clock.advance(2.0)
    expect(session.snapshot().elapsed).toBeCloseTo(3.0, 3)
  })

  it('seek は一時停止中と完了後と止めたあとは何もしない', () => {
    const [session, player] = makeSession()
    session.start()
    session.pause()
    session.seek(2)
    expect(session.snapshot().stepIndex).toBe(0)
    session.resume()
    playAllSteps(session)
    clock.advance(5.0)
    player.tick()
    expect(session.snapshot().isComplete).toBe(true)
    session.seek(0)
    expect(session.snapshot().stepIndex).toBe(3)
    session.restart()
    session.stop()
    session.seek(2)
    expect(session.snapshot().stepIndex).toBe(0)
  })
})

describe('GuideSession 一時停止', () => {
  it('pause で伴奏が止まり入力で進まない', () => {
    const [session, player] = makeSession()
    session.start()
    clock.advance(2.0)
    player.tick()
    session.pause()
    expect(session.snapshot().isPaused).toBe(true)
    expect(player.isPlaying).toBe(false)
    press(session, 60, 61)
    const snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.wrongCount).toBe(0)
    expect(snapshot.wrongHeldNotes).toEqual(new Set())
  })

  it('resume で元の hold に戻り入力で進む', () => {
    const [session, player] = makeSession()
    session.start()
    clock.advance(2.0)
    player.tick()
    session.pause()
    session.resume()
    expect(session.snapshot().isPaused).toBe(false)
    expect(player.isPlaying).toBe(true)
    expect(player.hold).toBe(0.5)
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(1)
    expect(player.hold).toBe(1.0)
  })

  it('pause 中は時計が進んでも伴奏の位置が動かない', () => {
    const [session, player] = makeSession()
    session.start()
    clock.advance(2.0)
    player.tick() // 0.5 で止まる
    press(session, 60)
    clock.advance(0.3)
    player.tick()
    expect(player.position).toBeCloseTo(0.8, 3)
    session.pause()
    clock.advance(5.0)
    player.tick()
    expect(player.position).toBeCloseTo(0.8, 3)
    session.resume()
    clock.advance(0.1)
    player.tick()
    expect(player.position).toBeCloseTo(0.9, 3)
    expect(player.hold).toBe(1.0)
  })

  it('経過時間に pause 中の時間を含めない', () => {
    const [session] = makeSession()
    session.start()
    clock.advance(1.0)
    session.pause()
    clock.advance(5.0)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 3)
    session.resume()
    clock.advance(2.0)
    expect(session.snapshot().elapsed).toBeCloseTo(3.0, 3)
  })

  it('最後のステップのあとの伴奏中でも pause と resume で続きが鳴る', () => {
    const [session, player] = makeSession()
    session.start()
    playAllSteps(session)
    clock.advance(0.5)
    player.tick()
    session.pause()
    expect(player.isPlaying).toBe(false)
    session.resume()
    expect(player.isPlaying).toBe(true)
    expect(player.hold).toBeNull()
    clock.advance(5.0)
    player.tick()
    expect(session.snapshot().isComplete).toBe(true)
  })

  it('完了後の pause は何もしない', () => {
    const [session, player] = makeSession()
    session.start()
    playAllSteps(session)
    clock.advance(5.0)
    player.tick()
    session.pause()
    expect(session.snapshot().isPaused).toBe(false)
    session.resume()
    expect(player.isPlaying).toBe(false)
  })

  it('最後のステップのあとの伴奏終了通知より先に pause が通っても resume で鳴り直さない', () => {
    const [session, player] = makeSession()
    session.start()
    playAllSteps(session)
    // 伴奏が終わっても onFinished がまだ届いていない状態にする
    const finished = player.onFinished
    player.onFinished = null
    clock.advance(5.0)
    player.tick()
    expect(player.isPlaying).toBe(false)
    session.pause()
    finished?.()
    session.resume()
    expect(player.isPlaying).toBe(false)
    expect(session.snapshot().isComplete).toBe(true)
    expect(session.snapshot().isPaused).toBe(false)
  })

  it('通知が届く前でも resume が伴奏の終わりを見て完了にする', () => {
    const [session, player] = makeSession()
    session.start()
    playAllSteps(session)
    player.onFinished = null
    clock.advance(5.0)
    player.tick()
    session.pause()
    session.resume()
    expect(player.isPlaying).toBe(false)
    expect(session.snapshot().isComplete).toBe(true)
  })

  it('pause 中に stop すると経過時間は pause した時刻で止まる', () => {
    const [session] = makeSession()
    session.start()
    clock.advance(1.0)
    session.pause()
    clock.advance(2.0)
    session.stop()
    clock.advance(5.0)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 3)
  })

  it('start 前の pause と resume は何もしない', () => {
    const [session, player] = makeSession()
    session.pause()
    session.resume()
    expect(session.snapshot().isPaused).toBe(false)
    expect(player.isPlaying).toBe(false)
  })

  it('stop のあとに入力しても hold が変わらない', () => {
    const [session, player] = makeSession()
    session.start()
    session.stop()
    player.hold = 0.8
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(0)
    expect(player.hold).toBe(0.8)
  })

  it('pause 中の入力は hold を書かない', () => {
    const [session, player] = makeSession()
    session.start()
    session.pause()
    player.hold = 0.8
    press(session, 60)
    expect(player.hold).toBe(0.8)
    session.resume()
    expect(player.hold).toBe(0.5)
  })
})

describe('GuideSession voiced（正解の音名を楽譜の高さで鳴らす）', () => {
  it('正解の音名でオクターブ違いを押すと楽譜の高さで鳴る', () => {
    const [session] = makeSession()
    session.start()
    // 待っているのは C4(60)。C5(72) を押すと 60 で鳴る
    expect(session.voiced(0, 72)).toEqual([60])
  })

  it('違う鍵は押した高さのまま鳴る', () => {
    const [session] = makeSession()
    session.start()
    expect(session.voiced(0, 62)).toEqual([62])
    expect(session.released(0, 62)).toEqual([62])
  })

  it('離すと差し替えた音が止まる', () => {
    const [session] = makeSession()
    session.start()
    session.voiced(0, 72)
    expect(session.released(0, 72)).toEqual([60])
    // velocity 0 の noteOn も released。ステップは E に進んでいるので、E3(52) は楽譜の E4(64) で鳴り、止めるのも 64
    expect(session.voiced(0, 52)).toEqual([64])
    expect(session.released(0, 52)).toEqual([64])
  })

  it('押したままステップが進んでから離しても押したときの音が止まる', () => {
    const [session] = makeSession()
    session.start()
    session.voiced(0, 72) // 判定は voiced で行われ、ステップが E に進む
    expect(session.snapshot().stepIndex).toBe(1)
    expect(session.released(0, 72)).toEqual([60])
  })

  it('止めたあとに離しても押したときの音が止まる', () => {
    const [session] = makeSession()
    session.start()
    session.voiced(0, 72)
    session.stop()
    // 表は残すので、止めたあとでも押したときの音を止められる。止めたあとの押下は差し替えない
    expect(session.released(0, 72)).toEqual([60])
    expect(session.voiced(0, 74)).toEqual([74])
  })

  it('最初からをまたいで押したままの鍵を離すと楽譜の音が止まる', () => {
    const [session] = makeSession()
    session.start()
    expect(session.voiced(0, 72)).toEqual([60])
    session.restart()
    expect(session.released(0, 72)).toEqual([60])
  })

  it('allNotesOff（CC123・CC120）で表が空になる', () => {
    for (const channel of [0, null]) {
      const [session] = makeSession()
      session.start()
      expect(session.voiced(0, 72)).toEqual([60]) // 72 → 60（C が待たれていて E へ進む）
      session.allNotesOff(channel)
      // 表が空なので、離しても覚えていない扱いでそのまま
      expect(session.released(0, 72)).toEqual([72])
      // 別の鍵が同じ楽譜の音に差し替わっても、参照数が 2 にならず離すと止まる
      session.restart()
      expect(session.voiced(0, 48)).toEqual([60])
      expect(session.released(0, 48)).toEqual([60])
    }
  })

  it('2 つの鍵が同じ楽譜の音になっても止め漏れが無い', () => {
    const [session] = makeSession()
    session.start()
    // C・E・G の和音のステップまで進める（C、E を順に弾いて離す）
    for (const n of [60, 64]) {
      session.voiced(0, n)
      session.released(0, n)
    }
    expect(session.snapshot().stepIndex).toBe(2)
    // C だけを 2 本で押す: 和音がそろわないのでステップは進まず、どちらも楽譜の C で鳴る
    expect(session.voiced(0, 60)).toEqual([60])
    expect(session.voiced(0, 72)).toEqual([60])
    expect(session.snapshot().stepIndex).toBe(2)
    // 片方を離しても、もう片方がまだ押しているので止めない
    expect(session.released(0, 72)).toEqual([])
    // 最後の 1 つを離したときに止める
    expect(session.released(0, 60)).toEqual([60])
    // 離したあとの余計な noteOff はそのまま
    expect(session.released(0, 60)).toEqual([60])
  })

  it('離さずに押し直しても止め漏れが無い', () => {
    const [session] = makeSession()
    session.start()
    expect(session.voiced(0, 72)).toEqual([60]) // E に進む
    // 同じ鍵を離さず押し直す: 先に鳴らした音を使い続ける
    expect(session.voiced(0, 72)).toEqual([60])
    expect(session.released(0, 72)).toEqual([60])
    expect(session.released(0, 72)).toEqual([72])
  })

  it('一時停止中と止めた後はそのまま鳴る', () => {
    const [session] = makeSession()
    session.start()
    session.pause()
    expect(session.voiced(0, 72)).toEqual([72])
    session.resume()
    expect(session.voiced(0, 71)).toEqual([71])
    session.stop()
    expect(session.voiced(0, 72)).toEqual([72])
  })

  /** ステップ: 0.5 秒に A4(69)・A3(57)・C4(60) の同時押し、1.0 秒に C4 */
  function makeOctaveSong(): SmfSong {
    const events: TimedMidiEvent[] = []
    for (const n of [69, 57, 60]) {
      events.push(noteOn(0.5, 0, n), noteOff(0.9, 0, n))
    }
    events.push(noteOn(1.0, 0, 60), noteOff(1.4, 0, 60))
    return makeSmf(events, 3.0, [0])
  }

  it('同じ音名の 2 音を 1 つの鍵で鳴らし離すと 2 音とも止まる', () => {
    const [session] = makeSession(makeOctaveSong())
    session.start()
    // A を押すと、楽譜の A3 と A4 の両方が鳴る（順序は問わない）
    const ons = session.voiced(0, 81)
    expect(ons.length).toBe(2)
    expect(new Set(ons)).toEqual(new Set([69, 57]))
    const offs = session.released(0, 81)
    expect(offs.length).toBe(2)
    expect(new Set(offs)).toEqual(new Set([69, 57]))
    // もう覚えていないので、余計な noteOff はそのまま
    expect(session.released(0, 81)).toEqual([81])
  })

  it('2 つの鍵が同じ音を共有すると参照数が 0 になった音だけ止まる', () => {
    const [session] = makeSession(makeOctaveSong())
    session.start()
    // 最初のステップ（A4・A3・C4）を A、C の順に押して進める
    session.voiced(0, 81) // A → A4, A3
    expect(session.voiced(0, 48)).toEqual([60]) // C → C4
    expect(session.snapshot().stepIndex).toBe(1)
    // 次のステップは C。C4 を別の鍵（72）でも押すと、C4 を 2 本の鍵が共有する
    expect(session.voiced(0, 72)).toEqual([60])
    // 片方（48）を離しても、もう片方（72）が C4 を使っているので止めない
    expect(session.released(0, 48)).toEqual([])
    expect(session.released(0, 72)).toEqual([60])
    const released = session.released(0, 81)
    expect(released.length).toBe(2)
    expect(new Set(released)).toEqual(new Set([69, 57]))
  })

  it('複数音の鍵を離さずに押し直すと同じ音を返し離すと全部止まる', () => {
    const [session] = makeSession(makeOctaveSong())
    session.start()
    const first = session.voiced(0, 81)
    expect(first.length).toBe(2)
    expect(new Set(first)).toEqual(new Set([69, 57]))
    // 離さずにもう一度押しても、先に鳴らした同じ 2 音（順序は問わない）
    const again = session.voiced(0, 81)
    expect(again.length).toBe(2)
    expect(new Set(again)).toEqual(new Set([69, 57]))
    // 参照数は増えていないので、1 回離せば 2 音とも止まる
    const offs = session.released(0, 81)
    expect(offs.length).toBe(2)
    expect(new Set(offs)).toEqual(new Set([69, 57]))
    expect(session.released(0, 81)).toEqual([81])
  })

  it('複数音の鍵を押したあと allNotesOff で表が空になる', () => {
    const [session] = makeSession(makeOctaveSong())
    session.start()
    expect(session.voiced(0, 81).length).toBe(2)
    session.allNotesOff(null)
    // 表が空なので、覚えていない鍵としてそのまま送る
    expect(session.released(0, 81)).toEqual([81])
  })

  it('ch1 の allNotesOff で 128 以上の slot の表も空になる', () => {
    const [session] = makeSession()
    session.start()
    expect(session.voiced(1, 60)).toEqual([60])
    session.allNotesOff(1)
    expect(session.released(1, 60)).toEqual([60])
  })

  it('全消しで違う鍵の印が手ごとに消える', () => {
    const [session] = makeSession()
    session.start()
    session.voiced(0, 61)
    session.voiced(1, 62)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set([61, 62]))
    session.allNotesOff(1)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set([61]))
    session.voiced(1, 62)
    session.allNotesOff(0)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set([62]))
    session.voiced(0, 61)
    session.allNotesOff(1) // CC123 を ch1 に受けた相当
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set([61]))
    session.allNotesOff(0) // CC120 を ch0 に受けた相当
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set())
    session.voiced(0, 61)
    session.voiced(1, 62)
    session.allNotesOff(null)
    expect(session.snapshot().wrongHeldNotes).toEqual(new Set())
  })

  it('複数音の鍵を押したまま restart しても離すと 2 音とも止まる', () => {
    const [session] = makeSession(makeOctaveSong())
    session.start()
    expect(session.voiced(0, 81).length).toBe(2)
    session.restart()
    const offs = session.released(0, 81)
    expect(offs.length).toBe(2)
    expect(new Set(offs)).toEqual(new Set([69, 57]))
  })

  it('複数音のうち別の鍵が押している音は離しても止まらない', () => {
    const [session] = makeSession(makeOctaveSong())
    // start 前は判定せず押した鍵のまま鳴る: 鍵 57 が 57 を押している
    expect(session.voiced(0, 57)).toEqual([57])
    session.start()
    const ons = session.voiced(0, 81)
    expect(ons.length).toBe(2)
    expect(new Set(ons)).toEqual(new Set([69, 57]))
    // 57 は鍵 57 がまだ押しているので残り、69 だけ止まる
    expect(session.released(0, 81)).toEqual([69])
    expect(session.released(0, 57)).toEqual([57])
  })

  it('違う鍵の押下中を入力の手ごとに分ける', () => {
    const [session] = makeHandsSession({ split: { kind: 'byNote', lowestRight: 60 } })
    session.start()
    session.voiced(1, 61)
    let snapshot = session.snapshot()
    expect(wrongHeldNotesOf(snapshot, 'left')).toEqual(new Set([61]))
    expect(wrongHeldNotesOf(snapshot, 'right')).toEqual(new Set())
    expect(snapshot.wrongHeldNotes).toEqual(new Set([61]))
    expect(snapshot.wrongCount).toBe(1)
    session.released(1, 61)
    snapshot = session.snapshot()
    expect(wrongHeldNotesOf(snapshot, 'left')).toEqual(new Set())
    expect(snapshot.wrongHeldNotes).toEqual(new Set())
    // ch 0 の違う鍵は右手側だけ
    session.voiced(0, 62)
    snapshot = session.snapshot()
    expect(wrongHeldNotesOf(snapshot, 'right')).toEqual(new Set([62]))
    expect(wrongHeldNotesOf(snapshot, 'left')).toEqual(new Set())
  })

  it('同じ音でも送り先の ch が違えば参照数を分ける', () => {
    const [session] = makeHandsSession({ hands: 'rightOnly', split: { kind: 'none' } })
    session.start()
    // 違う鍵の 61 を ch0 と ch1 で押す。送り先の ch が違うので、片方を離せばその ch の 61 は止まる
    session.voiced(0, 61)
    session.voiced(1, 61)
    expect(session.released(0, 61)).toEqual([61])
    expect(session.released(1, 61)).toEqual([61])
  })

  it('同じ ch で 2 つの鍵が同じ音を鳴らすときは最後の 1 つを離すまで止めない', () => {
    const [session] = makeHandsSession({ song: makeSameNoteSong(), hands: 'rightOnly', split: { kind: 'none' } })
    session.start()
    // 1.0 秒も 2.0 秒も 60。72 を押したあとステップが進み、次の 48 も同じ 60 を鳴らす
    expect(session.voiced(0, 72)).toEqual([60])
    expect(session.voiced(0, 48)).toEqual([60])
    expect(session.released(0, 72)).toEqual([])
    expect(session.released(0, 48)).toEqual([60])
  })

  it('両手で同じ高さを共有しても、右手を離せば ch0 の音が止まる', () => {
    const [session] = makeHandsSession({ song: makeSameNoteSong(), hands: 'both', split: { kind: 'byNote', lowestRight: 60 } })
    session.start()
    expect(session.voiced(0, 72)).toEqual([60])
    expect(session.voiced(1, 48)).toEqual([60])
    expect(session.released(0, 72)).toEqual([60])
    expect(session.released(1, 48)).toEqual([60])
  })
})

/** ch0・ch1 とも 1.0 秒に 60 があり、ch0 は 2.0 秒にも 60 がある曲 */
function makeSameNoteSong(): SmfSong {
  return makeSmf(
    [
      noteOn(1.0, 0, 60), noteOff(1.3, 0, 60), noteOn(1.0, 1, 60), noteOff(1.3, 1, 60),
      noteOn(2.0, 0, 60), noteOff(2.3, 0, 60),
    ],
    3.0,
    [0, 1],
  )
}

// MARK: - 両手

/** 右手 ch1（channel 0）と左手 ch2（channel 1）の曲。
 *  右手のみの列: 1.0 C4 / 2.0 E4 / 3.0 A4。両手の列: 1.0 右 C4 + 左 A2 / 2.0 右 E4 / 2.5 左 C3 / 3.0 右 A4 + 左 A3 */
function makeTwoHandSong(): SmfSong {
  const note = (channel: number, time: number, n: number): TimedMidiEvent[] => [
    noteOn(time, channel, n),
    noteOff(time + 0.3, channel, n),
  ]
  return makeSmf(
    [
      ...note(0, 1.0, 60), ...note(1, 1.0, 45),
      ...note(0, 2.0, 64),
      ...note(1, 2.5, 48),
      ...note(0, 3.0, 69), ...note(1, 3.0, 57),
    ],
    5.0,
    [0, 1],
  )
}

/** 左手の ch に音が無い曲（右手だけ） */
function makeRightOnlySong(): SmfSong {
  return makeSmf([noteOn(1.0, 0, 60), noteOff(1.3, 0, 60)], 3.0, [0])
}

interface HandsOptions {
  song?: SmfSong
  hands?: PlayHands
  split?: HandSplit
  pacing?: GuidePacing
}

function makeHandsSession(options: HandsOptions = {}): [GuideSession, SmfPlayer] {
  const player = makePlayer()
  const sessionOptions: GuideSessionOptions = {
    hands: options.hands ?? 'both',
    split: options.split ?? { kind: 'byNote', lowestRight: 60 },
    clock,
    pacing: options.pacing ?? GuidePacing.off,
  }
  const session = new GuideSession(options.song ?? makeTwoHandSong(), player, sessionOptions)
  return [session, player]
}

describe('GuideSession 両手', () => {
  it('両手で右手と左手の音名がそろって進む', () => {
    const [session, player] = makeHandsSession()
    expect(session.canPlayBothHands).toBe(true)
    session.start()
    expect(player.hold).toBe(1.0)
    expect(session.snapshot().stepCount).toBe(4)
    expect(session.snapshot().hands).toBe('both')
    press(session, 60) // 右手の C
    let snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.collectedPitchClasses).toEqual(new Set([0]))
    expect(snapshot.collectedLeftPitchClasses).toEqual(new Set())
    // 左手の区域の A（オクターブ違い）。左手の楽譜の A2 を鳴らす
    expect(session.voiced(0, 33)).toEqual([45])
    snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(1)
    expect(snapshot.collectedMask).toBe(0)
    expect(snapshot.collectedLeftMask).toBe(0)
    expect(snapshot.wrongCount).toBe(0)
    expect(player.hold).toBe(2.0)
  })

  it('右手の A と左手の A を別に数える', () => {
    const [session, player] = makeHandsSession()
    session.start()
    press(session, 60, 45, 64, 48) // 3 ステップ目（左手だけ）まで
    expect(session.snapshot().stepIndex).toBe(3)
    expect(player.hold).toBe(3.0)
    press(session, 81) // 右の区域の A: 右手の A だけそろう
    let snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(3)
    expect(snapshot.collectedPitchClasses).toEqual(new Set([9]))
    expect(snapshot.collectedLeftPitchClasses).toEqual(new Set())
    expect(snapshot.wrongCount).toBe(0)
    press(session, 33) // 左の区域の A
    snapshot = session.snapshot()
    expect(snapshot.isFinished).toBe(true)
    expect(player.hold).toBeNull()
  })

  it('違う手の区域で押した音は違う鍵に数える', () => {
    const [session] = makeHandsSession()
    session.start()
    // 最初のステップは右手 C・左手 A。右の区域の A、左の区域の C は違う鍵
    press(session, 69, 48)
    let snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.wrongCount).toBe(2)
    expect(snapshot.wrongHeldNotes).toEqual(new Set([69, 48]))
    expect(snapshot.collectedMask).toBe(0)
    expect(snapshot.collectedLeftMask).toBe(0)
    // 違う鍵は押した鍵のまま鳴る
    expect(session.voiced(0, 61)).toEqual([61])
    press(session, 60, 45)
    snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(1)
    // 右手だけのステップ（E）で、左の区域の E は違う鍵
    press(session, 40)
    expect(session.snapshot().stepIndex).toBe(1)
    expect(session.snapshot().wrongCount).toBe(4)
  })

  it('左手だけのステップは左手だけで進む', () => {
    const [session, player] = makeHandsSession()
    session.start()
    press(session, 60, 45, 64)
    expect(session.snapshot().stepIndex).toBe(2)
    expect(player.hold).toBe(2.5)
    press(session, 72) // 右の区域の C は、左手だけのステップでは違う鍵
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().wrongCount).toBe(1)
    expect(session.voiced(0, 36)).toEqual([48])
    expect(session.snapshot().stepIndex).toBe(3)
    expect(player.hold).toBe(3.0)
  })

  it('音の高さで手を分ける', () => {
    const [session] = makeHandsSession({ split: { kind: 'byNote', lowestRight: 62 } })
    session.start()
    press(session, 60) // 62 未満は左手: C は左手の音名ではない
    expect(session.snapshot().wrongCount).toBe(1)
    press(session, 72, 45)
    expect(session.snapshot().stepIndex).toBe(1)
  })

  it('setSplit で分け方を替えられる', () => {
    const [session] = makeHandsSession({ split: { kind: 'none' } })
    session.start()
    press(session, 45) // 分けない: 全部右手なので A は違う鍵
    expect(session.snapshot().wrongCount).toBe(1)
    session.setSplit({ kind: 'byNote', lowestRight: 60 })
    press(session, 60, 45)
    expect(session.snapshot().stepIndex).toBe(1)
  })

  it('右手だけでは左手の区域も右手として判定する', () => {
    const [session, player] = makeHandsSession({ hands: 'rightOnly' })
    session.start()
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(session.snapshot().stepCount).toBe(3)
    press(session, 48) // 低い鍵でも、右手の C として進む
    expect(session.snapshot().stepIndex).toBe(1)
    expect(player.hold).toBe(2.0)
  })

  it('両手では ch1 と ch2 をミュートし右手だけでは ch1 だけをミュートする', () => {
    const [both, bothPlayer] = makeHandsSession({ hands: 'both' })
    both.start()
    expect(bothPlayer.mutedChannels).toEqual(new Set([0, 1]))
    const [right, rightPlayer] = makeHandsSession({ hands: 'rightOnly' })
    right.start()
    expect(rightPlayer.mutedChannels).toEqual(new Set([0]))
  })

  it('左手の音が無い曲では両手にできない', () => {
    const [session, player] = makeHandsSession({ song: makeRightOnlySong(), hands: 'both' })
    expect(session.canPlayBothHands).toBe(false)
    session.start()
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(player.mutedChannels).toEqual(new Set([0]))
    session.setHands('both')
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(session.snapshot().stepCount).toBe(1)
    expect(player.mutedChannels).toEqual(new Set([0]))
    expect(player.hold).toBe(1.0)
  })

  it('演奏中に右手だけから両手へ替えると同じ時刻以降の最初のステップへ移る', () => {
    const [session, player] = makeHandsSession({ hands: 'rightOnly' })
    session.start()
    press(session, 60, 64) // 右手だけの 3 ステップ目（3.0）
    press(session, 70) // 違う鍵
    expect(session.snapshot().stepIndex).toBe(2)
    session.setHands('both')
    const snapshot = session.snapshot()
    expect(snapshot.hands).toBe('both')
    expect(snapshot.stepCount).toBe(4)
    expect(snapshot.stepIndex).toBe(3) // 両手の列の 3.0（2.5 の左手だけのステップには戻らない）
    expect(snapshot.wrongCount).toBe(1)
    expect(snapshot.wrongHeldNotes).toEqual(new Set([70]))
    expect(player.hold).toBe(3.0)
    expect(player.mutedChannels).toEqual(new Set([0, 1]))
    expect(session.score.steps.length).toBe(4)
    // 同じ操作を 2 度しても変わらない
    session.setHands('both')
    expect(session.snapshot().stepIndex).toBe(3)
  })

  it('演奏中に両手から右手だけへ替えると集めた音名を空にして移る', () => {
    const [session, player] = makeHandsSession({ hands: 'both' })
    session.start()
    press(session, 60, 45, 64) // 両手の列の 2.5（左手だけのステップ）
    expect(session.snapshot().stepIndex).toBe(2)
    session.setHands('rightOnly')
    let snapshot = session.snapshot()
    expect(snapshot.hands).toBe('rightOnly')
    expect(snapshot.stepCount).toBe(3)
    expect(snapshot.stepIndex).toBe(2) // 右手だけの列の 3.0
    expect(player.hold).toBe(3.0)
    expect(player.mutedChannels).toEqual(new Set([0]))
    expect(session.score.steps.length).toBe(3)
    // 最初のステップで途中まで集めたあとの切り替え
    session.restart()
    session.setHands('both')
    press(session, 60)
    expect(session.snapshot().collectedPitchClasses).toEqual(new Set([0]))
    session.setHands('rightOnly')
    snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.collectedMask).toBe(0)
    expect(snapshot.collectedLeftMask).toBe(0)
    expect(player.hold).toBe(1.0)
  })

  it('弾き終えたあとの setHands は列を替えず次の start で使われる', () => {
    const [session, player] = makeHandsSession({ hands: 'rightOnly' })
    session.start()
    press(session, 60, 64, 69)
    expect(session.snapshot().isFinished).toBe(true)
    session.setHands('both')
    // 弾き終えた画面の列・ステップ・ミュートは変わらない
    expect(session.snapshot().isFinished).toBe(true)
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(session.snapshot().stepIndex).toBe(3)
    expect(player.mutedChannels).toEqual(new Set([0]))
    // もう一度で、選んだ両手で始まる
    session.restart()
    expect(session.snapshot().hands).toBe('both')
    expect(session.snapshot().stepCount).toBe(4)
    expect(session.snapshot().stepIndex).toBe(0)
    expect(player.mutedChannels).toEqual(new Set([0, 1]))
    expect(player.hold).toBe(1.0)
  })

  it('止めたあとの setHands は player に触らない', () => {
    const [session, player] = makeHandsSession({ hands: 'rightOnly' })
    session.start()
    session.stop()
    session.setHands('both')
    expect(player.mutedChannels).toEqual(new Set([0]))
    expect(player.hold).toBeNull()
  })

  /** 右手 ch1 の C が 2.0、左手 ch2 の A が 3.0 の曲（右手だけの列は 1 ステップ、両手の列は 2 ステップ） */
  function makeLeftTailSong(): SmfSong {
    return makeSmf(
      [noteOn(2.0, 0, 60), noteOff(2.3, 0, 60), noteOn(3.0, 1, 45), noteOff(3.3, 1, 45)],
      5.0,
      [0, 1],
    )
  }

  it('一時停止中に弾き終えた扱いになっても経過時間に一時停止の時間が混ざらない', () => {
    const [session] = makeHandsSession({ song: makeLeftTailSong(), hands: 'both' })
    session.start()
    clock.advance(1.0)
    press(session, 60) // 両手の列の 3.0（左手だけ）
    expect(session.snapshot().stepIndex).toBe(1)
    session.pause()
    clock.advance(10.0)
    session.setHands('rightOnly') // 右手だけの列に 3.0 以降のステップは無い
    expect(session.snapshot().isFinished).toBe(true)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 9)
    clock.advance(10.0)
    expect(session.snapshot().elapsed).toBeCloseTo(1.0, 9)
  })

  it('演奏中の setHands で弾き終えると hold が外れ伴奏が終わると完了になる', () => {
    const [session, player] = makeHandsSession({ song: makeLeftTailSong(), hands: 'both' })
    session.start()
    press(session, 60)
    expect(player.hold).toBe(3.0)
    session.setHands('rightOnly')
    expect(player.hold).toBeNull()
    expect(session.snapshot().isFinished).toBe(true)
    expect(session.snapshot().isComplete).toBe(false)
    clock.advance(10.0)
    player.tick()
    expect(session.snapshot().isComplete).toBe(true)
  })

  it('分け方が none の間は両手の列にならず選んだ手は覚えておく', () => {
    const [session, player] = makeHandsSession({ hands: 'both', split: { kind: 'none' } })
    session.start()
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(session.snapshot().stepCount).toBe(3)
    expect(player.mutedChannels).toEqual(new Set([0]))
    session.setSplit({ kind: 'byNote', lowestRight: 60 })
    expect(session.snapshot().hands).toBe('both')
    expect(session.snapshot().stepCount).toBe(4)
    expect(player.mutedChannels).toEqual(new Set([0, 1]))
    session.setSplit({ kind: 'none' })
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(player.mutedChannels).toEqual(new Set([0]))
    // 右手だけを選んでいれば、分け方を替えても両手にならない
    const [right] = makeHandsSession({ hands: 'rightOnly', split: { kind: 'none' } })
    right.start()
    right.setSplit({ kind: 'byNote', lowestRight: 60 })
    expect(right.snapshot().hands).toBe('rightOnly')
    // split が none のまま setHands('both') しても右手だけ。あとで分け方を決めれば両手になる
    const [late] = makeHandsSession({ hands: 'rightOnly', split: { kind: 'none' } })
    late.start()
    late.setHands('both')
    expect(late.snapshot().hands).toBe('rightOnly')
    late.setSplit({ kind: 'byNote', lowestRight: 60 })
    expect(late.snapshot().hands).toBe('both')
  })

  it('scoreFor は手に応じた列を返す', () => {
    const [session] = makeHandsSession({ hands: 'rightOnly' })
    expect(session.scoreFor('rightOnly').steps.length).toBe(3)
    expect(session.scoreFor('leftOnly').steps.length).toBe(3)
    expect(session.scoreFor('leftOnly').steps.map((s) => s.notes)).toEqual([[45], [48], [57]])
    expect(session.scoreFor('both').steps.length).toBe(4)
    const [single] = makeHandsSession({ song: makeRightOnlySong(), hands: 'both' })
    expect(single.scoreFor('both').steps.length).toBe(1)
    expect(single.scoreFor('leftOnly').steps.length).toBe(1)
    expect(single.scoreFor('rightOnly').steps.length).toBe(1)
  })
})

describe('GuideSession 左手だけ', () => {
  it('左手だけでは左手の音名で進み右手を伴奏として鳴らす', () => {
    const [session, player] = makeHandsSession({ hands: 'leftOnly' })
    session.start()
    let snapshot = session.snapshot()
    expect(snapshot.hands).toBe('leftOnly')
    expect(snapshot.stepCount).toBe(3) // 左手の列: 1.0 A2 / 2.5 C3 / 3.0 A3
    expect(player.mutedChannels).toEqual(new Set([1]))
    expect(player.hold).toBe(1.0)
    // 右の区域の C（右手の音名）は違う鍵
    expect(session.voiced(0, 72)).toEqual([72])
    expect(session.snapshot().wrongCount).toBe(1)
    // 高い鍵の A でも左手の A として進み、楽譜の高さ（A2）で鳴る
    expect(session.voiced(0, 81)).toEqual([45])
    snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(1)
    expect(player.hold).toBe(2.5)
    press(session, 48, 57)
    expect(session.snapshot().isFinished).toBe(true)
    expect(player.hold).toBeNull()
  })

  it('左手だけは手を分けない鍵盤でも選べる', () => {
    const [session, player] = makeHandsSession({ hands: 'leftOnly', split: { kind: 'none' } })
    session.start()
    expect(session.snapshot().hands).toBe('leftOnly')
    expect(player.mutedChannels).toEqual(new Set([1]))
    // ch2 から来た入力も同じく左手として数える
    session.voiced(1, 45)
    expect(session.snapshot().stepIndex).toBe(1)
  })

  it('演奏中に右手だけから左手だけへ替えると同じ時刻以降の最初のステップへ移る', () => {
    const [session, player] = makeHandsSession({ hands: 'rightOnly' })
    session.start()
    press(session, 60) // 右手だけの列の 2.0
    session.setHands('leftOnly')
    let snapshot = session.snapshot()
    expect(snapshot.hands).toBe('leftOnly')
    expect(snapshot.stepIndex).toBe(1) // 左手の列の 2.5
    expect(player.hold).toBe(2.5)
    expect(player.mutedChannels).toEqual(new Set([1]))
    // 左手だけから両手へ
    session.setHands('both')
    snapshot = session.snapshot()
    expect(snapshot.hands).toBe('both')
    expect(snapshot.stepIndex).toBe(2) // 両手の列の 2.5
    expect(player.mutedChannels).toEqual(new Set([0, 1]))
  })

  it('左手の音が無い曲では左手だけにできない', () => {
    const [session, player] = makeHandsSession({ song: makeRightOnlySong(), hands: 'leftOnly' })
    session.start()
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(player.mutedChannels).toEqual(new Set([0]))
    session.setHands('leftOnly')
    expect(session.snapshot().hands).toBe('rightOnly')
    expect(player.hold).toBe(1.0)
  })

  it('右手と左手の最初の音が少しずれた曲でも切り替えでステップを飛ばさない', () => {
    // 左手 1.000・右手 1.010（右手だけの列は 1.010、両手の列は 1.000）
    const song = makeSmf(
      [
        noteOn(1.0, 1, 45), noteOn(1.01, 0, 60),
        noteOff(1.3, 1, 45), noteOff(1.31, 0, 60),
        noteOn(2.0, 0, 64), noteOff(2.3, 0, 64),
      ],
      4.0,
      [0, 1],
    )
    const [session, player] = makeHandsSession({ song, hands: 'rightOnly' })
    session.start()
    expect(player.hold).toBe(1.01)
    session.setHands('both')
    expect(session.snapshot().stepIndex).toBe(0)
    expect(player.hold).toBe(1.0)
  })

  it('右手だけから両手へ替えると ch2 の鳴っている音が止まる', () => {
    // ch2 の A が 0.2〜1.5 に鳴り、右手の C（1.0）の手前で止まっている
    const song = makeSmf(
      [
        noteOn(0.2, 1, 45), noteOn(1.0, 0, 60),
        noteOff(1.5, 1, 45), noteOff(1.5, 0, 60),
        noteOn(2.0, 0, 64), noteOff(2.3, 0, 64),
      ],
      4.0,
      [0, 1],
    )
    const [session, player] = makeHandsSession({ song, hands: 'rightOnly' })
    session.start()
    clock.advance(3.0)
    player.tick()
    expect(player.isHeld).toBe(true)
    expect(logHas('noteOn', 1, 45)).toBe(true)
    expect(logHas('noteOff', 1, 45)).toBe(false)
    session.setHands('both')
    expect(logHas('noteOff', 1, 45)).toBe(true)
    expect(session.snapshot().stepIndex).toBe(1) // 両手の列の 1.0（0.2 の左手だけのステップには戻らない）
  })

  it('一時停止中の setHands のあと resume で新しい列の hold になる', () => {
    const [session, player] = makeHandsSession({ hands: 'both' })
    session.start()
    press(session, 60, 45, 64) // 両手の列の 2.5
    session.pause()
    session.setHands('rightOnly')
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().isPaused).toBe(true)
    expect(player.mutedChannels).toEqual(new Set([0]))
    // 一時停止中は入力で進めない
    press(session, 69)
    expect(session.snapshot().stepIndex).toBe(2)
    session.resume()
    expect(player.hold).toBe(3.0)
  })
})

describe('GuideSession 1 音で OK', () => {
  it('和音のどれか 1 音で進み和音を全部鳴らす', () => {
    const [session, player] = makeSession()
    session.setOneNote(true)
    session.start()
    press(session, 60, 64)
    expect(session.snapshot().stepIndex).toBe(2)
    // C+E+G の和音。G を押すと押した G を先に、残りの C・E も鳴らして進む
    expect(session.voiced(0, 67)).toEqual([67, 60, 64])
    expect(session.snapshot().isFinished).toBe(true)
    expect(player.hold).toBeNull()
  })

  it('違う鍵は数えて進まない', () => {
    const [session] = makeSession()
    session.setOneNote(true)
    session.start()
    press(session, 62)
    const snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.wrongCount).toBe(1)
  })

  it('最初からをまたいで保ち途中で切ると元に戻る', () => {
    const [session] = makeSession()
    session.setOneNote(true)
    session.start()
    session.restart()
    press(session, 60, 64, 67)
    expect(session.snapshot().isFinished).toBe(true)
    session.setOneNote(false)
    session.restart()
    press(session, 60, 64, 67)
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().collectedPitchClasses).toEqual(new Set([7]))
  })

  it('両手は右手と左手で 1 音ずつ押すと進む', () => {
    // 1.0 秒に右手 C4+E4・左手 A2+E3 の和音、2.0 秒に右手 G4
    const note = (channel: number, time: number, n: number): TimedMidiEvent[] => [
      noteOn(time, channel, n),
      noteOff(time + 0.3, channel, n),
    ]
    const song = makeSmf(
      [...note(0, 1.0, 60), ...note(0, 1.0, 64), ...note(1, 1.0, 45), ...note(1, 1.0, 52), ...note(0, 2.0, 67)],
      4.0,
      [0, 1],
    )
    const [session, player] = makeHandsSession({ song })
    session.setOneNote(true)
    session.start()
    // 右手は E だけ。右手の C も集めたことにし、右手の和音を鳴らす
    expect(session.voiced(0, 64)).toEqual([64, 60])
    let snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.collectedPitchClasses).toEqual(new Set([0, 4]))
    expect(snapshot.collectedLeftPitchClasses).toEqual(new Set())
    // 右手の区域でもう 1 音押しても左手はそろわない
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(0)
    // 左手は A だけ。左手の和音を鳴らして進む
    expect(session.voiced(0, 45)).toEqual([45, 52])
    snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(1)
    expect(snapshot.wrongCount).toBe(0)
    expect(player.hold).toBe(2.0)
  })
})

describe('GuideSession 伴奏より先へ進まない', () => {
  it('窓の幅は間隔の半分を下限と上限に収める', () => {
    const pacing = GuidePacing.standard
    expect(pacing.window(0.5)).toBeCloseTo(0.25, 9)
    expect(pacing.window(0.1)).toBeCloseTo(0.1, 9)
    expect(pacing.window(2.0)).toBeCloseTo(0.5, 9)
  })

  it('窓より前の押鍵は押した鍵のまま鳴らし違う鍵にも数えず進まない', () => {
    const [session, player] = makeSession(makeSong(), GuidePacing.standard)
    session.start()
    // 最初のステップは 0.5 秒。曲の頭からの間隔 0.5 秒の半分、0.25 秒から受け付ける
    clock.advance(0.2)
    player.tick()
    expect(session.voiced(0, 72)).toEqual([72])
    let snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(0)
    expect(snapshot.wrongCount).toBe(0)
    release(session, 72)
    clock.advance(0.1)
    player.tick()
    expect(session.voiced(0, 72)).toEqual([60])
    snapshot = session.snapshot()
    expect(snapshot.stepIndex).toBe(1)
    expect(player.hold).toBe(1.0)
  })

  it('伴奏が待っていればすぐ受け付けるが続けて先のステップは済ませられない', () => {
    const [session, player] = makeSession(makeSong(), GuidePacing.standard)
    session.start()
    clock.advance(2.0)
    player.tick()
    expect(player.isHeld).toBe(true)
    press(session, 60)
    expect(session.snapshot().stepIndex).toBe(1)
    // 次の E は 1.0 秒。伴奏はまだ 0.5 秒なので受け付けない
    clock.advance(0.1)
    player.tick()
    press(session, 64)
    expect(session.snapshot().stepIndex).toBe(1)
    // 0.75 秒を過ぎたら受け付ける
    clock.advance(0.2)
    player.tick()
    press(session, 64)
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().wrongCount).toBe(0)
  })

  it('間隔が窓の下限より短いと前のステップを済ませた直後から受け付ける', () => {
    // 0.5 秒に C、0.55 秒に E
    const song = makeSmf(
      [noteOn(0.5, 0, 60), noteOn(0.55, 0, 64), noteOff(0.7, 0, 60), noteOff(0.7, 0, 64)],
      2.0,
      [0],
    )
    const [session, player] = makeSession(song, GuidePacing.standard)
    session.start()
    clock.advance(1.0)
    player.tick()
    press(session, 60)
    // 続けて押した E は済んだステップに無い音名なのでまとめず、窓は下限の 0.1 秒で 0.45 秒から開いている
    press(session, 64)
    expect(session.snapshot().isFinished).toBe(true)
  })

  it('1 音で OK で同じ和音が続いても押しずれは済んだステップの続きとして鳴らす', () => {
    // 0.5・0.7・0.9 秒に C4+E4 の和音
    const events: TimedMidiEvent[] = []
    for (const time of [0.5, 0.7, 0.9]) {
      for (const n of [60, 64]) events.push(noteOn(time, 0, n), noteOff(time + 0.15, 0, n))
    }
    const [session, player] = makeSession(makeSmf(events, 2.0, [0]), GuidePacing.standard)
    session.setOneNote(true)
    session.start()
    clock.advance(1.0)
    player.tick()
    expect(session.voiced(0, 60)).toEqual([60, 64])
    expect(session.snapshot().stepIndex).toBe(1)
    // 30ms 遅れて押した E5 は済んだステップの E として楽譜の高さで鳴らし、次の和音には使わない
    clock.advance(0.03)
    expect(session.voiced(0, 76)).toEqual([64])
    expect(session.snapshot().stepIndex).toBe(1)
    // 伴奏が次の和音の手前まで来たら、1 音で次へ進む
    clock.advance(0.1)
    player.tick()
    press(session, 64)
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().wrongCount).toBe(0)
  })
})

describe('GuideSession 弾いて進めた回数', () => {
  it('正しい音でステップを進めると advancedSteps が増える', () => {
    const [session] = makeSession()
    session.start()
    expect(session.snapshot().advancedSteps).toBe(0)
    press(session, 61) // 違う鍵では増えない
    expect(session.snapshot().advancedSteps).toBe(0)
    press(session, 60)
    expect(session.snapshot().advancedSteps).toBe(1)
    press(session, 64)
    expect(session.snapshot().advancedSteps).toBe(2)
    // 最初からで 0 に戻る
    session.restart()
    expect(session.snapshot().advancedSteps).toBe(0)
  })

  it('seek では advancedSteps が増えない', () => {
    const [session] = makeSession()
    session.start()
    session.seek(2)
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().advancedSteps).toBe(0)
  })

  it('自動演奏では advancedSteps が増えない', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    clock.advance(1.2)
    player.tick()
    expect(session.snapshot().stepIndex).toBe(2)
    expect(session.snapshot().advancedSteps).toBe(0)
  })

  it('手を替えて 0 番目のままステップが動いても advancedSteps は増えない', () => {
    // 左手 ch2（channel 1）が先、右手 ch1（channel 0）があと。右手だけの列は 2.0 の 1 ステップ、両手の列は 1.0 左 / 2.0 右
    const song = makeSmf(
      [noteOn(1.0, 1, 45), noteOff(1.3, 1, 45), noteOn(2.0, 0, 60), noteOff(2.3, 0, 60)],
      5.0,
      [0, 1],
    )
    const [session] = makeHandsSession({ song, hands: 'rightOnly' })
    session.start()
    expect(session.snapshot().stepIndex).toBe(0)
    session.setHands('both')
    // 新しい列の同じ時刻以降のステップへ移る（左手の前奏の次）が、弾いてはいない
    expect(session.snapshot().stepIndex).toBe(1)
    expect(session.snapshot().advancedSteps).toBe(0)
    // 分け方を替えても同じ
    session.setSplit({ kind: 'byNote', lowestRight: 62 })
    expect(session.snapshot().advancedSteps).toBe(0)
  })
})

describe('GuideSession 自動演奏', () => {
  it('自動演奏は弾く手のミュートと hold を外し判定しない', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    expect(player.mutedChannels).toEqual(new Set())
    expect(player.hold).toBeNull()
    expect(session.snapshot().autoplay).toBe('playing')
    // 違う鍵を押しても数えず、正しい鍵でも進めない
    press(session, 61)
    press(session, 60)
    expect(session.snapshot().wrongCount).toBe(0)
    expect(session.snapshot().collectedMask).toBe(0)
  })

  it('自動演奏中のステップは伴奏の位置以降で最初のステップ', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    clock.advance(0.7)
    player.tick()
    expect(session.snapshot().stepIndex).toBe(1)
  })

  it('自動演奏を止めると今の位置以降で最初のステップで待つ', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    clock.advance(0.7)
    player.tick()
    session.stopAutomatically()
    const snapshot = session.snapshot()
    expect(snapshot.autoplay).toBe('off')
    expect(snapshot.stepIndex).toBe(1)
    expect(player.mutedChannels).toEqual(new Set([0]))
    expect(player.hold).toBe(1.0)
    // 止めたあとは判定に戻る
    press(session, 64)
    expect(session.snapshot().stepIndex).toBe(2)
  })

  it('自動演奏が最後まで流れたら止まったままで弾き終わりにしない', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    clock.advance(3.5)
    player.tick()
    const snapshot = session.snapshot()
    expect(snapshot.autoplay).toBe('finished')
    expect(snapshot.isComplete).toBe(false)
    expect(player.isPlaying).toBe(false)
    // 止めると先頭のステップから弾くのを待つ
    session.stopAutomatically()
    expect(session.snapshot().stepIndex).toBe(0)
    expect(player.hold).toBe(0.5)
    expect(player.position).toBeCloseTo(0, 9)
  })

  it('自動演奏が最後まで流れたあとに移ると弾くのを待つ状態でそのステップへ移る', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    clock.advance(3.5)
    player.tick()
    session.seek(1)
    const snapshot = session.snapshot()
    expect(snapshot.autoplay).toBe('off')
    expect(snapshot.stepIndex).toBe(1)
    expect(player.hold).toBe(1.0)
    expect(player.mutedChannels).toEqual(new Set([0]))
  })

  it('自動演奏中に移ると hold を付けずに続ける', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    session.seek(2)
    expect(player.position).toBeCloseTo(1.5, 9)
    expect(player.hold).toBeNull()
    expect(player.isPlaying).toBe(true)
    expect(session.snapshot().stepIndex).toBe(2)
  })

  it('一時停止から戻ると自動演奏は hold を付けずに続ける', () => {
    const [session, player] = makeSession()
    session.start()
    session.playAutomatically()
    session.pause()
    expect(player.isPlaying).toBe(false)
    session.resume()
    expect(player.isPlaying).toBe(true)
    expect(player.hold).toBeNull()
    expect(player.mutedChannels).toEqual(new Set())
  })
})
