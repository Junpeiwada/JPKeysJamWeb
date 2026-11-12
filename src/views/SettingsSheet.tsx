import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { AppSettings } from '../library/settings'
import type { KeyRangePreference } from '../guide/keyRange'
import type { MidiDevice, StartResult } from '../midi/webMidi'
import './SettingsSheet.css'

export interface SettingsSheetProps {
  settings: AppSettings
  /** 入力機器（connected も含む） */
  devices: readonly MidiDevice[]
  /** 'idle' はまだ start していない */
  midiStatus: StartResult | 'idle'
  /** 「自動」のとき実際に使っている鍵盤数（表示用） */
  resolvedKeyCount: 13 | 25
  onClose(): void
}

const KEY_RANGE_OPTIONS: readonly { value: KeyRangePreference; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'keys13', label: '13 鍵' },
  { value: 'keys25', label: '25 鍵' },
]

/** 設定のシート。横画面では右から、縦画面では下から出る */
export function SettingsSheet({ settings, devices, midiStatus, resolvedKeyCount, onClose }: SettingsSheetProps) {
  // 設定の変更を購読して表示へ反映する（getter の値は不変なのでスナップショットに使える）
  const keyRange = useSyncExternalStore(
    (cb) => settings.subscribe(cb),
    () => settings.keyRange,
  )
  const oneNote = useSyncExternalStore(
    (cb) => settings.subscribe(cb),
    () => settings.oneNote,
  )

  // 開いたら閉じるボタンへフォーカスを移し、閉じたら（アンマウントで）元の要素へ戻す
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const connected = devices.filter((d) => d.connected)

  let deviceNote: string | null = null
  if (midiStatus === 'unsupported') {
    deviceNote = 'このブラウザは Web MIDI に対応していません。Android または PC の Chrome で開いてください'
  } else if (midiStatus === 'denied') {
    deviceNote = 'MIDI の使用が許可されませんでした。サイトの設定で MIDI を許可してください'
  } else if (midiStatus === 'failed') {
    deviceNote = 'MIDI 機器を開けませんでした。ページを開き直してください'
  } else if (connected.length === 0) {
    deviceNote = 'つながっていません。USB（OTG）で MIDI 鍵盤をつなぐと、ここに出ます'
  }

  return (
    <div className="settings-scrim" onClick={onClose}>
      <div
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="設定"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <h2>設定</h2>
          <button type="button" ref={closeRef} className="settings-close" onClick={onClose}>
            閉じる
          </button>
        </header>

        <section className="settings-section">
          <h3>演奏</h3>
          <label className="settings-card settings-toggle">
            <span>1音でOK</span>
            <input
              type="checkbox"
              checked={oneNote}
              onChange={(e) => {
                settings.oneNote = e.target.checked
              }}
            />
          </label>
          <p className="settings-note">和音は、片手につき 1 音押せば進みます。その手の残りの音も一緒に鳴ります</p>
        </section>

        <section className="settings-section">
          <h3>鍵盤</h3>
          <div className="settings-segmented" role="radiogroup" aria-label="鍵盤数">
            {KEY_RANGE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={keyRange === o.value}
                className={keyRange === o.value ? 'selected' : ''}
                onClick={() => {
                  settings.keyRange = o.value
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          {keyRange === 'auto' && <p className="settings-note">いま: {resolvedKeyCount} 鍵</p>}
        </section>

        <section className="settings-section">
          <h3>MIDI 機器</h3>
          {connected.length > 0 && midiStatus !== 'unsupported' && midiStatus !== 'denied' && midiStatus !== 'failed' && (
            <ul className="settings-card settings-devices">
              {connected.map((d) => (
                <li key={d.id}>{d.name}</li>
              ))}
            </ul>
          )}
          {deviceNote && <p className="settings-note">{deviceNote}</p>}
        </section>

        <section className="settings-section">
          <h3>ライセンス</h3>
          <ul className="settings-card settings-licenses">
            <li>
              音源: GeneralUser GS v2.0.3 — S. Christian Collins（
              <a href={`${import.meta.env.BASE_URL}licenses/GeneralUser-GS.txt`} target="_blank" rel="noreferrer">
                ライセンス
              </a>
              ）
            </li>
            <li>
              spessasynth_lib — Apache License 2.0（
              <a href={`${import.meta.env.BASE_URL}licenses/spessasynth_lib-LICENSE.txt`} target="_blank" rel="noreferrer">
                ライセンス
              </a>
              ）
            </li>
            <li>
              spessasynth_core — Apache License 2.0（
              <a href={`${import.meta.env.BASE_URL}licenses/spessasynth_core-LICENSE.txt`} target="_blank" rel="noreferrer">
                ライセンス
              </a>
              ）
            </li>
            <li>曲: 作曲者の著作権が切れた曲（パブリックドメイン）だけを収録。編曲は JPKeysJam</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
