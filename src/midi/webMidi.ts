import type { MidiMessage } from './types'

/** 画面に出す MIDI 入力機器の情報 */
export interface MidiDevice {
  id: string
  name: string
  manufacturer: string
  connected: boolean
}

/** MIDIInput のうち使う部分（DOM の型に依存せず、テストで偽物を作れるようにする） */
export interface MidiInputLike {
  id: string
  name?: string | null
  manufacturer?: string | null
  type?: string
  state?: string
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null
}

/** MIDIAccess のうち使う部分 */
export interface MidiAccessLike {
  inputs: { values(): Iterable<MidiInputLike> }
  onstatechange: ((event: unknown) => void) | null
}

/** requestMIDIAccess 相当の関数 */
export type RequestMidiAccess = (options?: { sysex?: boolean }) => Promise<MidiAccessLike>

/** Web MIDI で届くバイト列 1 件を MidiMessage にする。扱わないものは null。
 *  ランニングステータスは Web MIDI では来ないので扱わない */
export function parseMidiBytes(data: Uint8Array): MidiMessage | null {
  if (data.length === 0) return null
  const status = data[0]
  // データバイトから始まる・システムメッセージ（0xF0〜）は無視
  if (status < 0x80 || status >= 0xf0) return null
  const kind = status & 0xf0
  const channel = status & 0x0f
  const d1 = data[1]
  const d2 = data[2]
  switch (kind) {
    case 0x80:
      if (data.length < 3) return null
      return { type: 'noteOff', channel, note: d1 & 0x7f, velocity: d2 & 0x7f }
    case 0x90:
      if (data.length < 3) return null
      // ベロシティ 0 の Note On は Note Off
      if ((d2 & 0x7f) === 0) return { type: 'noteOff', channel, note: d1 & 0x7f, velocity: 0 }
      return { type: 'noteOn', channel, note: d1 & 0x7f, velocity: d2 & 0x7f }
    case 0xb0:
      if (data.length < 3) return null
      return { type: 'controlChange', channel, controller: d1 & 0x7f, value: d2 & 0x7f }
    case 0xc0:
      if (data.length < 2) return null
      return { type: 'programChange', channel, program: d1 & 0x7f }
    case 0xe0:
      if (data.length < 3) return null
      return { type: 'pitchBend', channel, value: ((d2 & 0x7f) << 7) | (d1 & 0x7f) }
    default:
      // ポリフォニックプレッシャー・チャンネルプレッシャーは使わない
      return null
  }
}

/** start の結果。'unsupported' は非対応ブラウザ、'failed' は許可以外の理由で開けなかったこと。
 *  'stopped' は、待っている間に stop が呼ばれて取り消されたこと */
export type StartResult = 'ok' | 'unsupported' | 'denied' | 'failed' | 'stopped'

/** Web MIDI の入力。非対応ブラウザでは start が 'unsupported' を返すだけで、何も起きない */
export class WebMidiInput {
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
  }

  private readonly request: RequestMidiAccess | null
  private access: MidiAccessLike | null = null
  /** stop のたびに進める。古い世代の start は結果を捨てる */
  private generation = 0
  /** 進行中の start（2 回目以降は同じ Promise を返す） */
  private pending: Promise<StartResult> | null = null
  private attached = new Set<MidiInputLike>()
  private messageListeners = new Set<(msg: MidiMessage, deviceId: string) => void>()
  private deviceListeners = new Set<(devices: MidiDevice[]) => void>()

  /** request を渡すと requestMIDIAccess の代わりに使う（テスト用） */
  constructor(request?: RequestMidiAccess) {
    if (request) {
      this.request = request
    } else if (WebMidiInput.isSupported()) {
      this.request = (options) =>
        navigator.requestMIDIAccess(options) as unknown as Promise<MidiAccessLike>
    } else {
      this.request = null
    }
  }

  start(): Promise<StartResult> {
    if (this.access) return Promise.resolve('ok')
    if (!this.request) return Promise.resolve('unsupported')
    if (this.pending) return this.pending
    const promise = this.doStart(this.request, this.generation)
    this.pending = promise
    void promise.finally(() => {
      if (this.pending === promise) this.pending = null
    })
    return promise
  }

  private async doStart(request: RequestMidiAccess, generation: number): Promise<StartResult> {
    let access: MidiAccessLike
    try {
      // sysex は要求しない
      access = await request({ sysex: false })
    } catch (e) {
      if (generation !== this.generation) return 'stopped'
      // DOMException が無い環境もあるので、instanceof ではなく name で見る
      const name = (e as { name?: unknown } | null)?.name
      return name === 'SecurityError' || name === 'NotAllowedError' ? 'denied' : 'failed'
    }
    // 待っている間に stop されたら、access を持たずハンドラも付けない
    if (generation !== this.generation) return 'stopped'
    this.access = access
    access.onstatechange = () => {
      this.syncInputs()
      this.notifyDevices()
    }
    this.syncInputs()
    this.notifyDevices()
    return 'ok'
  }

  /** 入力機器の一覧（入力だけ） */
  devices(): MidiDevice[] {
    if (!this.access) return []
    const result: MidiDevice[] = []
    for (const input of this.access.inputs.values()) {
      if (input.type !== undefined && input.type !== 'input') continue
      result.push({
        id: input.id,
        name: input.name ?? '',
        manufacturer: input.manufacturer ?? '',
        connected: input.state === undefined || input.state === 'connected',
      })
    }
    return result
  }

  /** つながっている入力機器の名前だけ（Chromium は抜いても inputs に残り、state が disconnected になる） */
  connectedDeviceNames(): string[] {
    return this.devices()
      .filter((d) => d.connected)
      .map((d) => d.name)
  }

  onMessage(listener: (msg: MidiMessage, deviceId: string) => void): () => void {
    this.messageListeners.add(listener)
    return () => {
      this.messageListeners.delete(listener)
    }
  }

  onDevicesChange(listener: (devices: MidiDevice[]) => void): () => void {
    this.deviceListeners.add(listener)
    return () => {
      this.deviceListeners.delete(listener)
    }
  }

  stop(): void {
    this.generation++
    this.pending = null
    for (const input of this.attached) input.onmidimessage = null
    this.attached.clear()
    if (this.access) this.access.onstatechange = null
    this.access = null
  }

  /** 今ある入力に onmidimessage を付け、外れた入力からは外す */
  private syncInputs(): void {
    if (!this.access) return
    const current = new Set<MidiInputLike>()
    for (const input of this.access.inputs.values()) {
      if (input.type !== undefined && input.type !== 'input') continue
      current.add(input)
      if (!this.attached.has(input)) {
        input.onmidimessage = (event) => this.handle(event.data, input.id)
        this.attached.add(input)
      }
    }
    for (const input of [...this.attached]) {
      if (!current.has(input)) {
        input.onmidimessage = null
        this.attached.delete(input)
      }
    }
  }

  private handle(data: Uint8Array | null, deviceId: string): void {
    if (!data) return
    const msg = parseMidiBytes(data)
    if (!msg) return
    for (const listener of [...this.messageListeners]) {
      try {
        listener(msg, deviceId)
      } catch (e) {
        console.error(e)
      }
    }
  }

  private notifyDevices(): void {
    const list = this.devices()
    for (const listener of [...this.deviceListeners]) {
      try {
        listener(list)
      } catch (e) {
        console.error(e)
      }
    }
  }
}
