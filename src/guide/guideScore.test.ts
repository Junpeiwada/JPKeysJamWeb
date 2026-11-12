import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GuideScore } from './guideScore'
import { KEYS25 } from './keyRange'
import { resolve } from './rollLayout'
import { parseSmf, type SmfSong } from '../midi/smf'
import type { TimedMidiEvent } from '../midi/types'

const on = (time: number, note: number, channel = 0, velocity = 100): TimedMidiEvent => ({
  time,
  message: { type: 'noteOn', channel, note, velocity },
})
const off = (time: number, note: number, channel = 0): TimedMidiEvent => ({
  time,
  message: { type: 'noteOff', channel, note, velocity: 0 },
})
const song = (events: TimedMidiEvent[], duration = 10): SmfSong => ({
  title: null,
  events,
  duration,
  usedChannels: new Set([0]),
  initialPrograms: new Map(),
  trackNames: new Map(),
})

describe('GuideScore', () => {
  it('単音の列', () => {
    const score = new GuideScore(song([on(0, 60), off(0.5, 60), on(0.5, 62), off(1, 62)]))
    expect(score.steps.length).toBe(2)
    expect(score.steps[0]).toEqual({
      time: 0,
      endTime: 0.5,
      notes: [60],
      pitchClasses: new Set([0]),
      leftNotes: [],
      leftPitchClasses: new Set(),
      noteEnds: [0.5],
      leftNoteEnds: [],
    })
    expect(score.steps[1].notes).toEqual([62])
    expect(score.steps[1].endTime).toBe(1)
  })

  it('和音は 30ms 以内でまとまり昇順になる', () => {
    const score = new GuideScore(
      song([on(1.0, 67), on(1.01, 60), on(1.02, 64), off(1.5, 60), off(1.6, 64), off(1.7, 67)]),
    )
    expect(score.steps.length).toBe(1)
    expect(score.steps[0].time).toBe(1.0)
    expect(score.steps[0].notes).toEqual([60, 64, 67])
    expect(score.steps[0].pitchClasses).toEqual(new Set([0, 4, 7]))
    expect(score.steps[0].endTime).toBe(1.7)
  })

  it('窓は最初の音から測り連鎖しない', () => {
    const score = new GuideScore(song([on(0, 60), on(0.02, 62), on(0.04, 64)]))
    expect(score.steps.map((s) => s.notes)).toEqual([[60, 62], [64]])
    expect(score.steps[1].time).toBeCloseTo(0.04, 9)
  })

  it('窓の外は別ステップ', () => {
    const score = new GuideScore(song([on(0, 60), on(0.05, 64)]))
    expect(score.steps.length).toBe(2)
  })

  it('他の ch と制御イベントは無視する', () => {
    const score = new GuideScore(
      song([
        on(0, 40, 1),
        on(0, 60),
        { time: 0.1, message: { type: 'controlChange', channel: 0, controller: 64, value: 127 } },
        off(0.5, 60),
        off(0.5, 40, 1),
      ]),
    )
    expect(score.steps.length).toBe(1)
    expect(score.steps[0].notes).toEqual([60])
  })

  it('channel を指定できる', () => {
    const score = new GuideScore(song([on(0, 40, 1), on(0, 60)]), { playChannel: 1 })
    expect(score.steps.map((s) => s.notes)).toEqual([[40]])
  })

  it('velocity 0 の noteOn は noteOff 扱い', () => {
    const score = new GuideScore(song([on(0, 60), on(0.4, 60, 0, 0), on(1, 62)]))
    expect(score.steps.length).toBe(2)
    expect(score.steps[0].endTime).toBeCloseTo(0.4, 9)
  })

  it('離れない音の終わりは曲の長さ', () => {
    const score = new GuideScore(song([on(0, 60)], 3))
    expect(score.steps[0].endTime).toBe(3)
  })

  it('音が無い曲は空', () => {
    const score = new GuideScore(song([]))
    expect(score.steps).toEqual([])
    expect(score.longestLength).toBe(0)
  })

  it('窓ちょうど 30ms の音は同じステップになる', () => {
    // 0.13 - 0.1 は浮動小数で 0.030000000000000013 になる
    const score = new GuideScore(song([on(0.1, 60), on(0.13, 64)]))
    expect(score.steps.map((s) => s.notes)).toEqual([[60, 64]])
  })

  it('対応する noteOn の無い noteOff は無視する', () => {
    const score = new GuideScore(song([off(0, 60), on(1, 60), off(2, 60), off(3, 62), on(4, 62)], 10))
    expect(score.steps.map((s) => s.notes)).toEqual([[60], [62]])
    expect(score.steps[0].endTime).toBe(2)
    expect(score.steps[1].endTime).toBe(10)
  })

  it('同じ音を重ねたときは先入れ先出しで閉じる', () => {
    const score = new GuideScore(song([on(0, 60), on(1, 60), off(2, 60), off(3, 60)]))
    expect(score.steps.length).toBe(2)
    expect(score.steps[0].time).toBe(0)
    expect(score.steps[0].endTime).toBe(2)
    expect(score.steps[1].time).toBe(1)
    expect(score.steps[1].endTime).toBe(3)
  })

  it('同じ時刻に off と on が並ぶ連打', () => {
    const score = new GuideScore(song([on(0, 60), off(0.5, 60), on(0.5, 60), off(1, 60)]))
    expect(score.steps.length).toBe(2)
    expect(score.steps[0].endTime).toBe(0.5)
    expect(score.steps[1].time).toBe(0.5)
    expect(score.steps[1].endTime).toBe(1)
  })

  it('leftChannel が無ければ右手だけで左手は空', () => {
    const score = new GuideScore(song([on(0, 60), on(0, 40, 1), off(0.5, 60), off(0.5, 40, 1)]))
    expect(score.steps.length).toBe(1)
    expect(score.steps[0].notes).toEqual([60])
    expect(score.steps[0].leftNotes).toEqual([])
    expect(score.steps[0].leftPitchClasses).toEqual(new Set())
    expect(score.steps[0]).toEqual({
      time: 0,
      endTime: 0.5,
      notes: [60],
      pitchClasses: new Set([0]),
      leftNotes: [],
      leftPitchClasses: new Set(),
      noteEnds: [0.5],
      leftNoteEnds: [],
    })
  })

  it('両手が同時なら 1 ステップに右と左が分かれて入る', () => {
    const score = new GuideScore(
      song([
        on(0, 64),
        on(0.01, 48, 1),
        on(0.02, 52, 1),
        off(0.5, 64),
        off(0.8, 48, 1),
        off(0.6, 52, 1),
      ]),
      { leftChannel: 1 },
    )
    expect(score.steps.length).toBe(1)
    expect(score.steps[0].notes).toEqual([64])
    expect(score.steps[0].pitchClasses).toEqual(new Set([4]))
    expect(score.steps[0].leftNotes).toEqual([48, 52])
    expect(score.steps[0].leftPitchClasses).toEqual(new Set([0, 4]))
    expect(score.steps[0].time).toBe(0)
    expect(score.steps[0].endTime).toBe(0.8)
  })

  it('片方の手だけのステップもある', () => {
    const score = new GuideScore(
      song([on(0, 60), off(0.4, 60), on(1, 43, 1), off(1.5, 43, 1), on(2, 62), off(2.2, 62)]),
      { leftChannel: 1 },
    )
    expect(score.steps.length).toBe(3)
    expect(score.steps[0].notes).toEqual([60])
    expect(score.steps[0].leftNotes).toEqual([])
    expect(score.steps[1].notes).toEqual([])
    expect(score.steps[1].pitchClasses).toEqual(new Set())
    expect(score.steps[1].leftNotes).toEqual([43])
    expect(score.steps[1].endTime).toBe(1.5)
    expect(score.steps[2].notes).toEqual([62])
    expect(score.times).toEqual([0, 1, 2])
    expect(score.longestLength).toBeCloseTo(0.5, 9)
  })

  it('位置で鳴っているステップは始まりから鳴り終わりの手前まで', () => {
    const score = new GuideScore(
      song([on(0, 60), off(2, 60), on(1, 62), off(1.5, 62), on(3, 64), off(3.5, 64)]),
    )
    expect(score.soundingSteps(0)).toEqual([0])
    expect(score.soundingSteps(1.2)).toEqual([0, 1])
    expect(score.soundingSteps(1.5)).toEqual([0])
    expect(score.soundingSteps(2.5)).toEqual([])
    expect(score.soundingSteps(3)).toEqual([2])
    expect(score.soundingSteps(-1)).toEqual([])
  })

  it('鳴っている音は音ごとの鳴り終わりで消える', () => {
    const score = new GuideScore(
      song([on(0, 60), on(0, 64, 1), on(0.01, 67), off(0.5, 67), off(1, 64, 1), off(2, 60)]),
      { leftChannel: 1 },
    )
    expect(score.steps.length).toBe(1)
    expect(score.steps[0].noteEnds).toEqual([2, 0.5])
    expect(score.steps[0].leftNoteEnds).toEqual([1])
    expect(score.soundingNotes(0.2).right).toEqual([60, 67])
    expect(score.soundingNotes(0.2).left).toEqual([64])
    expect(score.soundingNotes(0.7).right).toEqual([60])
    expect(score.soundingNotes(1.5).left).toEqual([])
    expect(score.soundingNotes(2).right).toEqual([])
  })

  it('両手のまとめは 30ms の窓で行い右手だけの列とは別になる', () => {
    const score = new GuideScore(song([on(0, 60), on(0.05, 64, 1), on(0.06, 62)]), { leftChannel: 1 })
    expect(score.steps.map((s) => s.notes)).toEqual([[60], [62]])
    expect(score.steps.map((s) => s.leftNotes)).toEqual([[], [64]])
  })

  it('左手でも同じ音を重ねたときは先入れ先出しで閉じ右手と混ざらない', () => {
    const score = new GuideScore(song([on(0, 60), on(0.5, 60, 1), off(1, 60, 1), off(2, 60)]), {
      leftChannel: 1,
    })
    // 手を区別して閉じれば右手 60 は 2 で、左手 60 は 1 で閉じる（混ざると [1, 2]）
    expect(score.steps.map((s) => s.endTime)).toEqual([2, 1])
  })

  it('hasNotes は ch に noteOn があるかを返す', () => {
    const s = song([on(0, 60), on(0, 40, 1, 0), off(1, 60)])
    expect(GuideScore.hasNotes(s, 0)).toBe(true)
    expect(GuideScore.hasNotes(s, 1)).toBe(false)
    expect(GuideScore.hasNotes(song([]), 0)).toBe(false)
  })

  it('全曲でステップがあり和音は4音以内', () => {
    const dir = new URL('../../public/songs/', import.meta.url)
    interface Arrangement {
      id: string
      file: string
      hands: string
    }
    interface Entry {
      id: string
      arrangements: Arrangement[]
    }
    const entries = JSON.parse(readFileSync(new URL('songs.json', dir), 'utf8')) as Entry[]
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.arrangements.length, entry.id).toBeGreaterThan(0)
      for (const arrangement of entry.arrangements) {
        const parsed = parseSmf(new Uint8Array(readFileSync(new URL(arrangement.file, dir))))
        const score = new GuideScore(parsed)
        expect(score.steps.length, arrangement.id).toBeGreaterThan(0)
        expect(score.steps.every((s) => s.notes.length <= 4), arrangement.id).toBe(true)
        // 1 つのステップで同じノート番号が重複しない
        expect(
          score.steps.every((step) => new Set(step.notes).size === step.notes.length),
          arrangement.id,
        ).toBe(true)
        // 25 鍵（C3〜C5）の範囲で、全ステップの全音がどれかの鍵に振り替えられる
        expect(
          score.steps.every((step) => step.notes.every((n) => resolve(n, KEYS25.lowest, KEYS25.highest) !== null)),
          arrangement.id,
        ).toBe(true)

        const both = new GuideScore(parsed, { leftChannel: 1 })
        expect(
          both.steps.every((s) => s.notes.length <= 4 && s.leftNotes.length <= 4),
          arrangement.id,
        ).toBe(true)
        expect(
          both.steps.every((s) => s.notes.length > 0 || s.leftNotes.length > 0),
          arrangement.id,
        ).toBe(true)
        // 左手の音は hands が both の譜面にだけある
        expect(GuideScore.hasNotes(parsed, 1), arrangement.id).toBe(arrangement.hands === 'both')
      }
    }
  })
})
