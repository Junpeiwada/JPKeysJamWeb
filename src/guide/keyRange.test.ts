import { describe, it, expect } from 'vitest'
import {
  KEYS13,
  KEYS25,
  contains,
  keyCount,
  matchedDevice,
  normalizedDeviceName,
  notesWithPitchClass,
  resolve,
  whiteKeyCount,
} from './keyRange'

describe('KeyRange', () => {
  it('KEYS13 の寸法', () => {
    expect(KEYS13.lowest).toBe(60)
    expect(KEYS13.highest).toBe(72)
    expect(keyCount(KEYS13)).toBe(13)
    expect(whiteKeyCount(KEYS13)).toBe(8)
  })

  it('KEYS25 の寸法', () => {
    expect(KEYS25.lowest).toBe(48)
    expect(KEYS25.highest).toBe(72)
    expect(keyCount(KEYS25)).toBe(25)
    expect(whiteKeyCount(KEYS25)).toBe(15)
  })

  it('auto で機器名から決まる', () => {
    expect(resolve(['JP-MIDIKey13'], 'auto')).toEqual(KEYS13)
    expect(resolve(['JP-MIDIKey25'], 'auto')).toEqual(KEYS25)
  })

  it('auto で大文字小文字を区別しない', () => {
    expect(resolve(['jp-midikey13 bluetooth'], 'auto')).toEqual(KEYS13)
  })

  it('auto で区切りのある名前も判定できる', () => {
    expect(resolve(['JP-MIDIKey 25'], 'auto')).toEqual(KEYS25)
    expect(resolve(['MIDIKey-13'], 'auto')).toEqual(KEYS13)
    expect(resolve(['MIDIKey_13'], 'auto')).toEqual(KEYS13)
  })

  it('auto で無関係な機器と混在しても 13 を選ぶ', () => {
    expect(resolve(['Other', 'JP-MIDIKey13'], 'auto')).toEqual(KEYS13)
  })

  it('auto で両方つながっていれば 25', () => {
    expect(resolve(['JP-MIDIKey13', 'JP-MIDIKey25'], 'auto')).toEqual(KEYS25)
  })

  it('auto で該当機器が無ければ 25', () => {
    expect(resolve([], 'auto')).toEqual(KEYS25)
    expect(resolve(['Other Keyboard'], 'auto')).toEqual(KEYS25)
  })

  it('auto 以外は設定が機器名より優先', () => {
    expect(resolve(['JP-MIDIKey25'], 'keys13')).toEqual(KEYS13)
    expect(resolve(['JP-MIDIKey13'], 'keys25')).toEqual(KEYS25)
  })

  it('contains', () => {
    expect(contains(KEYS13, 60)).toBe(true)
    expect(contains(KEYS13, 72)).toBe(true)
    expect(contains(KEYS13, 59)).toBe(false)
    expect(contains(KEYS13, 73)).toBe(false)
  })

  it('KEYS25 の contains 境界', () => {
    expect(contains(KEYS25, 47)).toBe(false)
    expect(contains(KEYS25, 48)).toBe(true)
    expect(contains(KEYS25, 72)).toBe(true)
    expect(contains(KEYS25, 73)).toBe(false)
  })

  it('notesWithPitchClass', () => {
    expect(notesWithPitchClass(KEYS13, 0)).toEqual([60, 72])
    expect(notesWithPitchClass(KEYS25, 0)).toEqual([48, 60, 72])
    expect(notesWithPitchClass(KEYS25, 7)).toEqual([55, 67])
    expect(notesWithPitchClass(KEYS13, 1)).toEqual([61])
    expect(notesWithPitchClass(KEYS13, 12)).toEqual([])
    expect(notesWithPitchClass(KEYS13, -1)).toEqual([])
  })

  it('matchedDevice は鍵数に合う機器を選ぶ', () => {
    const names = ['JP-MIDIKey13', 'JP-MIDIKey25']
    expect(matchedDevice(names, 25)).toBe('JP-MIDIKey25')
    expect(matchedDevice(names, 13)).toBe('JP-MIDIKey13')
    expect(matchedDevice(['JP-MIDIKey 25'], 25)).toBe('JP-MIDIKey 25')
  })

  it('matchedDevice は合う機器が無ければ undefined', () => {
    expect(matchedDevice([], 25)).toBeUndefined()
    expect(matchedDevice(['Other Keyboard'], 25)).toBeUndefined()
    expect(matchedDevice(['JP-MIDIKey13'], 25)).toBeUndefined()
  })

  it('normalizedDeviceName', () => {
    expect(normalizedDeviceName('JP-MIDIKey 25')).toBe('jpmidikey25')
    expect(normalizedDeviceName('MIDI_Key-13 BT')).toBe('midikey13bt')
    expect(normalizedDeviceName('')).toBe('')
  })
})
