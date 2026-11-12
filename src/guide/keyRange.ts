// 画面に出す鍵盤の範囲（手本: App/Logic/KeyRange.swift）。13 鍵 × 2 台（keys13x2・isDual）は移さない。

/** 鍵盤数の設定値 */
export type KeyRangePreference = 'auto' | 'keys13' | 'keys25'

/** 画面に出す鍵盤の範囲。両端を含む MIDI ノート番号 */
export interface KeyRange {
  readonly lowest: number
  readonly highest: number
}

/** 13 鍵: C4〜C5（白鍵 8） */
export const KEYS13: KeyRange = Object.freeze({ lowest: 60, highest: 72 })
/** 25 鍵: C3〜C5（白鍵 15） */
export const KEYS25: KeyRange = Object.freeze({ lowest: 48, highest: 72 })

const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11]

export function keyCount(range: KeyRange): number {
  return range.highest - range.lowest + 1
}

/** 白鍵の数 */
export function whiteKeyCount(range: KeyRange): number {
  let count = 0
  for (let n = range.lowest; n <= range.highest; n++) {
    if (WHITE_PITCH_CLASSES.includes(n % 12)) count++
  }
  return count
}

export function contains(range: KeyRange, note: number): boolean {
  return note >= range.lowest && note <= range.highest
}

/** 範囲内で指定のピッチクラス（0〜11）に当たるノート番号を昇順で返す */
export function notesWithPitchClass(range: KeyRange, pc: number): number[] {
  if (!Number.isInteger(pc) || pc < 0 || pc > 11) return []
  const notes: number[] = []
  for (let n = range.lowest; n <= range.highest; n++) {
    if (n % 12 === pc) notes.push(n)
  }
  return notes
}

/** 機器名の判定用に、小文字にし、空白・ハイフン・アンダースコアを除く（"MIDIKey 25"、"MIDIKey-25" 対策） */
export function normalizedDeviceName(name: string): string {
  return name.toLowerCase().replace(/[ \-_]/g, '')
}

/** 鍵数（13・25）に合う機器名を、つながっている順で最初の 1 つ返す。無ければ undefined */
export function matchedDevice(names: readonly string[], keyCount: number): string | undefined {
  return names.find((n) => normalizedDeviceName(n).includes(`midikey${keyCount}`))
}

/** 接続中の機器名と設定値から鍵盤の範囲を決める */
export function resolve(deviceNames: readonly string[], preference: KeyRangePreference): KeyRange {
  switch (preference) {
    case 'keys13':
      return KEYS13
    case 'keys25':
      return KEYS25
    case 'auto': {
      const normalized = deviceNames.map(normalizedDeviceName)
      if (normalized.some((n) => n.includes('midikey25'))) return KEYS25
      if (normalized.some((n) => n.includes('midikey13'))) return KEYS13
      return KEYS25
    }
  }
}
