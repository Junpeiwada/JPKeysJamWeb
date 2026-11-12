// 音源。spessasynth_lib の WorkletSynthesizer を包む。
// import しただけでは AudioContext に触らない（start() の中で初めて作る）
import { WorkletSynthesizer } from 'spessasynth_lib'
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url'
import type { MidiMessage } from '../midi/types'

/** 音源ファイルの URL（SF3 に圧縮できなかったため SF2 を置いている） */
export const SOUNDFONT_URL = `${import.meta.env.BASE_URL}soundfont/piano.sf2`

type ControllerNumber = Parameters<WorkletSynthesizer['controllerChange']>[1]

/** 0〜127 に丸める */
function clamp7(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

/** テストで差し替える部品。既定はブラウザのもの */
export interface AudioEngineDeps {
  createContext?: () => AudioContext
  createSynth?: (context: AudioContext) => WorkletSynthesizer
  fetchFn?: (url: string) => Promise<Response>
}

export class AudioEngine {
  private context: AudioContext | null = null
  private synth: WorkletSynthesizer | null = null
  private starting: Promise<void> | null = null
  private ready = false
  private readonly readyListeners = new Set<(ready: boolean) => void>()
  private readonly createContext: () => AudioContext
  private readonly createSynth: (context: AudioContext) => WorkletSynthesizer
  private readonly fetchFn: (url: string) => Promise<Response>

  constructor(deps: AudioEngineDeps = {}) {
    this.createContext = deps.createContext ?? (() => new AudioContext({ latencyHint: 'interactive' }))
    this.createSynth = deps.createSynth ?? ((context) => new WorkletSynthesizer(context))
    this.fetchFn = deps.fetchFn ?? ((url) => fetch(url))
  }

  get isReady(): boolean {
    return this.ready
  }

  /** ready の変化（準備できた・closed などで使えなくなった）を購読する。戻り値で解除 */
  onReadyChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener)
    return () => {
      this.readyListeners.delete(listener)
    }
  }

  private setReady(value: boolean): void {
    if (this.ready === value) return
    this.ready = value
    for (const listener of [...this.readyListeners]) listener(value)
  }

  /** ユーザーのタップの中で呼ぶ。2 回目以降は同じ Promise を返す。失敗したら reject（再試行はできる） */
  start(): Promise<void> {
    if (this.starting) return this.starting
    const promise: Promise<void> = this.doStart().catch((error: unknown) => {
      // 途中で closed になって作り直された後なら、新しい context を壊さない
      if (this.starting === promise) {
        this.teardown()
        this.starting = null
      }
      throw error
    })
    this.starting = promise
    return promise
  }

  private async doStart(): Promise<void> {
    // タップの直後に同期で作らないと iOS Safari で鳴らない
    const context = this.createContext()
    this.context = context
    // 起動の途中で closed になり、teardown 済み（または作り直し済み）なら中断する
    const assertCurrent = (): void => {
      if (this.context !== context) throw new Error('AudioContext が閉じられました')
    }
    // Android などで AudioContext が closed になったら作り直せるようにする（interrupted・suspended は resume で戻るので対象外）
    context.onstatechange = () => {
      if (context.state === 'closed' && this.context === context) {
        this.teardown()
        this.starting = null
      }
    }
    // 音源ファイルの取得は AudioContext を作ったあとに始める（作る前に await しない）
    const fontRequest = this.fetchFn(SOUNDFONT_URL).then((response) => {
      if (!response.ok) throw new Error(`音源を読めませんでした (${response.status})`)
      return response.arrayBuffer()
    })
    // addModule が先に失敗しても unhandledrejection にしない（あとの await では元の例外がそのまま投げられる）
    fontRequest.catch(() => {})
    void context.resume().catch(() => {})
    await context.audioWorklet.addModule(processorUrl)
    assertCurrent()
    const synth = this.createSynth(context)
    this.synth = synth
    try {
      synth.connect(context.destination)
      const font = await fontRequest
      assertCurrent()
      await synth.soundBankManager.addSoundBank(font, 'main')
      assertCurrent()
      await synth.isReady
      assertCurrent()
    } catch (error) {
      // teardown 済みなら二重の destroy になるが無害
      if (this.synth !== synth) {
        try {
          synth.destroy()
        } catch {
          // 後始末なので無視する
        }
      }
      throw error
    }
    this.setReady(true)
    this.resetChannels()
  }

  private teardown(): void {
    this.setReady(false)
    try {
      this.synth?.destroy()
    } catch {
      // 失敗後の後始末なので無視する
    }
    if (this.context) this.context.onstatechange = null
    void this.context?.close().catch(() => {})
    this.synth = null
    this.context = null
  }

  /** AudioContext の時計（秒）。開始前は 0 */
  currentTime(): number {
    return this.context?.currentTime ?? 0
  }

  /** when は AudioContext の時刻（秒）。省略か過去なら即時。開始前・失敗後は黙って捨てる。
   *  when の予約はワークレット内のキューに入り取り消せない（allNotesOff・resetChannels・suspend の後でも鳴る）。
   *  止める可能性のある再生（伴奏・試聴）では when を使わず即時に送ること */
  send(message: MidiMessage, when?: number): void {
    const synth = this.live()
    if (!synth) return
    // spessasynth_lib の time オプションで、ワークレット側が時刻どおりに実行する
    const options = when !== undefined && when > synth.currentTime ? { time: when } : undefined
    const channel = message.channel
    switch (message.type) {
      case 'noteOn':
        synth.noteOn(channel, message.note, clamp7(message.velocity), options)
        break
      case 'noteOff':
        synth.noteOff(channel, message.note, options)
        break
      case 'controlChange':
        synth.controllerChange(
          channel,
          message.controller as ControllerNumber,
          clamp7(message.value),
          options,
        )
        break
      case 'programChange':
        synth.programChange(channel, message.program, options)
        break
      case 'pitchBend':
        synth.pitchWheel(channel, message.value, options)
        break
    }
  }

  /** when の扱いは send を参照（予約は取り消せない） */
  noteOn(channel: number, note: number, velocity: number, when?: number): void {
    this.send({ type: 'noteOn', channel, note, velocity }, when)
  }

  noteOff(channel: number, note: number, when?: number): void {
    this.send({ type: 'noteOff', channel, note, velocity: 0 }, when)
  }

  controlChange(channel: number, controller: number, value: number, when?: number): void {
    this.send({ type: 'controlChange', channel, controller, value }, when)
  }

  /** 省略は全 ch。即時 */
  allNotesOff(channel?: number): void {
    const synth = this.live()
    if (!synth) return
    if (channel === undefined) {
      synth.stopAll(true)
      return
    }
    // CC123（オールノートオフ）と CC120（オールサウンドオフ）
    synth.controllerChange(channel, 123 as ControllerNumber, 0)
    synth.controllerChange(channel, 120 as ControllerNumber, 0)
  }

  /** 全 ch を既定に戻し、ch1・ch2（0・1）を program 0 にする */
  resetChannels(): void {
    const synth = this.live()
    if (!synth) return
    synth.stopAll(true)
    synth.reset()
    synth.programChange(0, 0)
    synth.programChange(1, 0)
  }

  async suspend(): Promise<void> {
    const context = this.context
    if (!this.ready || !context) return
    this.allNotesOff()
    await context.suspend()
  }

  async resume(): Promise<void> {
    const context = this.context
    if (!this.ready || !context) return
    await context.resume()
  }

  /** 準備できているときだけ synth を返す */
  private live(): WorkletSynthesizer | null {
    return this.ready ? this.synth : null
  }
}

/** アプリ全体で 1 つ */
export const audioEngine = new AudioEngine()
