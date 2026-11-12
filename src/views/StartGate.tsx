import { useEffect, useRef, useState } from 'react'
import { audioEngine } from '../audio/engine'
import type { StartResult, WebMidiInput } from '../midi/webMidi'
import './StartGate.css'

export interface StartGateProps {
  /** 音源が使えるようになったら呼ぶ。midiResult はタップの中で始めた MIDI の start の結果 */
  onReady(midiResult: Promise<StartResult>): void
  midi: WebMidiInput
}

type Phase = 'idle' | 'loading' | 'failed'

/** 最初に 1 回だけ出す幕。タップで音と MIDI を始める（ブラウザは操作の中でしか音を出せないため） */
export function StartGate({ onReady, midi }: StartGateProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [reason, setReason] = useState('')
  // タップ後（AudioWorklet を取り始めた後）は service worker を入れ替えない。古い precache が消えると取得に失敗するため
  const tappedRef = useRef(false)

  // 幕を出している間（まだタップしていない間）に新しい版が待っていれば入れ替える（ページが再読み込みされる）。
  // Android の PWA はタスクに残っている間ずっと新しい版が入らないため、確認画面なしでここで入れる。開発では登録しない
  useEffect(() => {
    if (import.meta.env.DEV) return
    let cancelled = false
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return
      const updateSW = registerSW({
        onNeedRefresh() {
          if (!tappedRef.current) void updateSW(true)
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const start = () => {
    tappedRef.current = true
    setPhase('loading')
    // audioEngine.start() はタップのハンドラの中で同期に呼び始める（待たずに MIDI も並べて始める）
    const audio = audioEngine.start()
    // MIDI の許可が下りなくても曲は選べる。結果は App が受け取る（許可の確認をタップの外でもう一度出さないため）
    const midiResult = midi.start()
    midiResult.catch(() => {})
    audio.then(
      () => onReady(midiResult),
      (error: unknown) => {
        setReason(error instanceof Error ? error.message : '音源を始められませんでした')
        setPhase('failed')
      },
    )
  }

  return (
    <div className="start-gate">
      <h1 className="start-gate__logo">KeysJam</h1>
      {phase === 'loading' ? (
        <p className="start-gate__message">音を読み込んでいます…</p>
      ) : (
        <>
          {phase === 'failed' && (
            <p className="start-gate__message start-gate__message--error">
              音を始められませんでした（{reason}）
            </p>
          )}
          <button type="button" className="start-gate__button" onClick={start}>
            {phase === 'failed' ? 'やり直す' : 'タップして始める'}
          </button>
        </>
      )}
    </div>
  )
}
