// MIDI メッセージの型。channel は 0 始まり（0 = ch1 = 右手、1 = ch2 = 左手）
export type MidiMessage =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'controlChange'; channel: number; controller: number; value: number }
  | { type: 'programChange'; channel: number; program: number }
  | { type: 'pitchBend'; channel: number; value: number } // 0〜16383、中央 8192

/** time は曲の頭からの秒 */
export interface TimedMidiEvent {
  time: number
  message: MidiMessage
}
