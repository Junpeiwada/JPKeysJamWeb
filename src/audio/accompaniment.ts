// 演奏のつなぎ役（手本: App/Engine/AppHost.swift のうち 1 曲の演奏をつなぐ部分）。
// 伴奏（SmfPlayer）・弾く人の入力・判定（GuideSession）・音源をつなぐ。
// 画面・Firebase・音色・13 鍵 × 2 に関わる部分は移さない。hold とミュートは GuideSession が SmfPlayer に対して行う。
import { handFor } from '../guide/hand'
import type { Hand, HandSplit, PlayHands } from '../guide/hand'
import { GuideSession } from '../guide/guideSession'
import { KEYS13, keyCount } from '../guide/keyRange'
import type { KeyRange } from '../guide/keyRange'
import type { SmfSong } from '../midi/smf'
import type { MidiMessage } from '../midi/types'
import { audioEngine } from './engine'
import { SmfPlayer } from './smfPlayer'
import type { PlayerClock } from './smfPlayer'

/** 音の出力先。本番は audioEngine、テストでは偽物 */
export interface AccompanimentOutput {
  send(message: MidiMessage): void
  allNotesOff(channel?: number): void
  resetChannels(): void
}

export interface GuideControllerOptions {
  song: SmfSong
  hands: PlayHands
  /** 25 鍵なら手の分け目は C4（60）、13 鍵なら分けない */
  keyRange: KeyRange
  oneNote: boolean
  /** 既定は audioEngine */
  output?: AccompanimentOutput
  /** テスト用 */
  clock?: PlayerClock
  usesTimer?: boolean
}

/** 25 鍵の右手と左手の境目（C4） */
const LOWEST_RIGHT_NOTE = 60

/** 手が鳴らす ch（0 始まり）。右手 = ch1（0）、左手 = ch2（1） */
function channelFor(hand: Hand): number {
  return hand === 'left' ? 1 : 0
}

/** 鍵盤の範囲から決まる、入力の手の分け方 */
function splitFor(range: KeyRange): HandSplit {
  return keyCount(range) > keyCount(KEYS13) ? { kind: 'byNote', lowestRight: LOWEST_RIGHT_NOTE } : { kind: 'none' }
}

/**
 * 伴奏の sink を通すか。ch1・ch2（0・1）の Program Change と、音色を決める CC
 * （0・32 = バンク、7 = 音量、10 = パン、11 = エクスプレッション、91 = リバーブ、93 = コーラス）は捨てる。
 * 選んだ音色とつまみを曲に上書きさせないため
 */
function filteredAccompaniment(message: MidiMessage): MidiMessage | null {
  if (message.channel > 1) return message
  if (message.type === 'programChange') return null
  if (message.type === 'controlChange') {
    switch (message.controller) {
      case 0:
      case 32:
      case 7:
      case 10:
      case 11:
      case 91:
      case 93:
        return null
    }
  }
  return message
}

/**
 * 1 曲の演奏をつなぐ。伴奏は音源へ直接送り、判定（GuideSession）を通さない。
 * - effect の中で作り、後始末で dispose する。dispose 後は使い回さない（start などは何もしない）
 * - guide.voiced には手の ch（右手 0・左手 1）を渡すので、違う鍵の印は手ごとに分かれる。表示は左右を合わせて使う
 */
export class GuideController {
  readonly guide: GuideSession
  readonly player: SmfPlayer
  private readonly output: AccompanimentOutput
  private hands: PlayHands
  private keyRange: KeyRange
  /** 押している鍵（入力のノート番号）→ 鳴らした ch。Note Off を Note On と同じ ch へ送り、手が途中で変わっても音を残さない */
  private readonly pressed = new Map<number, number>()
  private disposed = false

  constructor(options: GuideControllerOptions) {
    this.output = options.output ?? audioEngine
    this.hands = options.hands
    this.keyRange = options.keyRange
    // 伴奏の sink は判定を通さない（通すと伴奏を弾いた音と取り違える）
    this.player = new SmfPlayer(
      (message) => {
        const kept = filteredAccompaniment(message)
        if (kept) this.output.send(kept)
      },
      { clock: options.clock, usesTimer: options.usesTimer },
    )
    // 弾き手が遅れて待っている間、伴奏の音は 1.5 秒だけ伸ばし、それを過ぎたら止める
    this.player.holdReleaseDelay = 1.5
    this.guide = new GuideSession(options.song, this.player, {
      hands: options.hands,
      split: splitFor(options.keyRange),
      clock: options.clock,
    })
    this.guide.setOneNote(options.oneNote)
  }

  // MARK: - 開始・停止

  /** 全 ch を既定に戻してから曲を始める */
  start(): void {
    if (this.disposed) return
    this.output.resetChannels()
    this.silencePlayedChannels()
    this.guide.start()
  }

  /** 前回の終わりの CC・RPN が残らないよう、全 ch を既定に戻してから最初からやり直す */
  restart(): void {
    if (this.disposed) return
    this.output.resetChannels()
    this.silencePlayedChannels()
    this.guide.restart()
  }

  /** 画面が裏に回ったときなど。伴奏を今の位置で止める */
  pause(): void {
    if (this.disposed) return
    this.guide.pause()
  }

  resume(): void {
    if (this.disposed) return
    this.guide.resume()
  }

  /** 止める。タイマーを外し、鳴らした音とペダル・ベンドを戻す */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.guide.stop()
    this.stopPlayedNotes()
    this.releasePedalAndBend()
  }

  // MARK: - 設定

  setHands(hands: PlayHands): void {
    const before = this.effectiveHands()
    this.hands = hands
    this.guide.setHands(hands)
    if (this.effectiveHands() !== before) this.releasePedalAndBend()
  }

  setKeyRange(range: KeyRange): void {
    const before = this.effectiveHands()
    this.keyRange = range
    this.guide.setSplit(splitFor(range))
    this.guide.setHands(this.hands)
    if (this.effectiveHands() !== before) this.releasePedalAndBend()
  }

  setOneNote(on: boolean): void {
    this.guide.setOneNote(on)
  }

  // MARK: - 入力

  /**
   * 弾く人の入力（外部 MIDI・画面の鍵盤）。
   * - Note On: 手の ch で鳴らす。鳴らす音は guide.voiced が決める（判定には手の ch を使う）
   * - Note Off（と velocity 0 の Note On）: Note On と同じ ch の音を guide.released が返すとおりに止める
   * - CC120・123: guide.allNotesOff し、ch1・ch2 の音を止める
   * - Program Change: 捨てる
   * - ほかの CC・ピッチベンド: 両手のとき ch1・ch2 の両方、片手のときその手の ch へ
   */
  handleInput(message: MidiMessage): void {
    if (this.disposed) return
    switch (message.type) {
      case 'noteOn':
        if (message.velocity > 0) this.noteOn(message.note, message.velocity)
        else this.noteOff(message.note)
        break
      case 'noteOff':
        this.noteOff(message.note)
        break
      case 'programChange':
        break
      case 'controlChange':
        if (message.controller === 120 || message.controller === 123) {
          this.pressed.clear()
          this.guide.allNotesOff(null)
          this.output.allNotesOff(0)
          this.output.allNotesOff(1)
        } else {
          for (const channel of this.controlChannels()) {
            this.output.send({ ...message, channel })
          }
        }
        break
      case 'pitchBend':
        for (const channel of this.controlChannels()) {
          this.output.send({ ...message, channel })
        }
        break
    }
  }

  private noteOn(note: number, velocity: number): void {
    const channel = this.pressed.get(note) ?? channelFor(this.handForNote(note))
    this.pressed.set(note, channel)
    for (const sounded of this.guide.voiced(channel, note)) {
      this.output.send({ type: 'noteOn', channel, note: sounded, velocity })
    }
  }

  private noteOff(note: number): void {
    const channel = this.pressed.get(note) ?? channelFor(this.handForNote(note))
    this.pressed.delete(note)
    for (const stopped of this.guide.released(channel, note)) {
      this.output.send({ type: 'noteOff', channel, note: stopped, velocity: 0 })
    }
  }

  // MARK: - 手

  /** 判定に使う手。左手の音が無い曲では右手だけ、25 鍵でなければ両手にしない */
  private effectiveHands(): PlayHands {
    if (!this.guide.canPlayBothHands) return 'rightOnly'
    if (this.hands === 'both' && splitFor(this.keyRange).kind === 'none') return 'rightOnly'
    return this.hands
  }

  /** 入力のノートを鳴らす手 */
  private handForNote(note: number): Hand {
    switch (this.effectiveHands()) {
      case 'rightOnly':
        return 'right'
      case 'leftOnly':
        return 'left'
      case 'both':
        return handFor(splitFor(this.keyRange), note)
    }
  }

  /** CC・ピッチベンドの送り先 ch。両手のときは ch1・ch2 の両方（どちらの手のペダルも両手の音に効く） */
  private controlChannels(): number[] {
    switch (this.effectiveHands()) {
      case 'both':
        return [0, 1]
      case 'leftOnly':
        return [1]
      case 'rightOnly':
        return [0]
    }
  }

  /** ch1・ch2 の音だけ止める。押した鍵の表と guide の表は残す（押したままの鍵の離し方を変えないため） */
  private silencePlayedChannels(): void {
    this.output.allNotesOff(0)
    this.output.allNotesOff(1)
  }

  /** 弾く人の音（ch1・ch2）を止める。押した鍵の表も空にする */
  private stopPlayedNotes(): void {
    this.pressed.clear()
    this.guide.allNotesOff(null)
    this.output.allNotesOff(0)
    this.output.allNotesOff(1)
  }

  /** 鳴らす手が変わった時点で、ch1・ch2 のペダル（CC64）を離しピッチベンドを中央に戻す（古い ch に値が残って音が伸びないように） */
  private releasePedalAndBend(): void {
    for (const channel of [0, 1]) {
      this.output.send({ type: 'controlChange', channel, controller: 64, value: 0 })
      this.output.send({ type: 'pitchBend', channel, value: 8192 })
    }
  }
}
