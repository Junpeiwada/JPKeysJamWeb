// AudioEngine のテスト。AudioContext・WorkletSynthesizer・fetch は差し替える
import { describe, expect, it, vi } from 'vitest'
import type { WorkletSynthesizer } from 'spessasynth_lib'
import { AudioEngine } from './engine'

/** 外から解決できる Promise */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class FakeContext {
  state: AudioContextState = 'running'
  onstatechange: (() => void) | null = null
  closed = false
  destination = {}
  addModule = deferred()
  audioWorklet = { addModule: () => this.addModule.promise }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
  /** ブラウザが context を閉じたことを再現する */
  forceClose(): void {
    this.state = 'closed'
    this.onstatechange?.()
  }
}

class FakeSynth {
  destroyed = false
  soundBank = deferred()
  soundBankManager = { addSoundBank: () => this.soundBank.promise }
  isReady = Promise.resolve()
  connect(): void {}
  destroy(): void {
    this.destroyed = true
  }
  stopAll(): void {}
  reset(): void {}
  programChange(): void {}
}

function setup() {
  const contexts: FakeContext[] = []
  const synths: FakeSynth[] = []
  const engine = new AudioEngine({
    createContext: () => {
      const context = new FakeContext()
      contexts.push(context)
      return context as unknown as AudioContext
    },
    createSynth: () => {
      const synth = new FakeSynth()
      synths.push(synth)
      return synth as unknown as WorkletSynthesizer
    },
    fetchFn: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
  })
  return { engine, contexts, synths }
}

describe('AudioEngine', () => {
  it('起動に成功すると ready になり onReadyChange へ true を知らせる', async () => {
    const { engine, contexts, synths } = setup()
    const changes: boolean[] = []
    engine.onReadyChange((ready) => changes.push(ready))
    const started = engine.start()
    contexts[0].addModule.resolve()
    await vi.waitFor(() => expect(synths).toHaveLength(1))
    synths[0].soundBank.resolve()
    await started
    expect(engine.isReady).toBe(true)
    expect(changes).toEqual([true])
  })

  it('addModule の途中で closed になると、ready にならず reject する', async () => {
    const { engine, contexts, synths } = setup()
    const started = engine.start()
    const rejected = expect(started).rejects.toThrow('AudioContext が閉じられました')
    contexts[0].forceClose()
    contexts[0].addModule.resolve()
    await rejected
    expect(engine.isReady).toBe(false)
    expect(synths).toHaveLength(0)
  })

  it('addSoundBank の途中で closed になると synth を壊して reject し、ready にならない', async () => {
    const { engine, contexts, synths } = setup()
    const changes: boolean[] = []
    engine.onReadyChange((ready) => changes.push(ready))
    const started = engine.start()
    const rejected = expect(started).rejects.toThrow('AudioContext が閉じられました')
    contexts[0].addModule.resolve()
    await vi.waitFor(() => expect(synths).toHaveLength(1))
    contexts[0].forceClose()
    synths[0].soundBank.resolve()
    await rejected
    expect(engine.isReady).toBe(false)
    expect(synths[0].destroyed).toBe(true)
    expect(changes).toEqual([])
  })

  it('ready のあとに closed になると onReadyChange へ false を知らせる', async () => {
    const { engine, contexts, synths } = setup()
    const changes: boolean[] = []
    engine.onReadyChange((ready) => changes.push(ready))
    const started = engine.start()
    contexts[0].addModule.resolve()
    await vi.waitFor(() => expect(synths).toHaveLength(1))
    synths[0].soundBank.resolve()
    await started
    contexts[0].forceClose()
    expect(engine.isReady).toBe(false)
    expect(changes).toEqual([true, false])
  })

  it('古い起動の失敗が、再タップで作った新しい context を壊さない', async () => {
    const { engine, contexts, synths } = setup()
    const first = engine.start()
    const firstRejected = expect(first).rejects.toThrow('AudioContext が閉じられました')
    contexts[0].forceClose() // teardown と starting のクリア
    const second = engine.start() // 再タップ
    expect(contexts).toHaveLength(2)
    contexts[0].addModule.resolve()
    await firstRejected
    expect(contexts[1].closed).toBe(false)
    contexts[1].addModule.resolve()
    await vi.waitFor(() => expect(synths).toHaveLength(1))
    synths[0].soundBank.resolve()
    await second
    expect(engine.isReady).toBe(true)
    expect(synths[0].destroyed).toBe(false)
  })

  it('解除関数を呼ぶと通知が止まる', async () => {
    const { engine, contexts, synths } = setup()
    const changes: boolean[] = []
    const off = engine.onReadyChange((ready) => changes.push(ready))
    off()
    const started = engine.start()
    contexts[0].addModule.resolve()
    await vi.waitFor(() => expect(synths).toHaveLength(1))
    synths[0].soundBank.resolve()
    await started
    expect(changes).toEqual([])
  })
})
