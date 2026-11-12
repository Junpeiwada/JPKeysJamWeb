import { useCallback, useEffect, useRef, useState } from 'react'
import { keyCount, resolve as resolveKeyRange } from './guide/keyRange'
import { PlayHistory } from './library/history'
import { audioEngine } from './audio/engine'
import { PreviewPlayer } from './audio/preview'
import { loadCatalog, type SongCatalog } from './library/catalog'
import { AppSettings } from './library/settings'
import { WebMidiInput, type MidiDevice, type StartResult } from './midi/webMidi'
import './App.css'
import { Home } from './views/Home'
import { PlayView } from './views/PlayView'
import { SettingsSheet } from './views/SettingsSheet'
import { SongDetail } from './views/SongDetail'
import { StartGate } from './views/StartGate'

// アプリ全体で 1 つずつ使う
const midi = new WebMidiInput()
const settings = new AppSettings()
const preview = new PreviewPlayer()
const history = new PlayHistory()

/** 幕 → ホーム → 曲の詳細 → 演奏。設定はシートで開く */
export default function App() {
  const [ready, setReady] = useState(false)
  const [catalog, setCatalog] = useState<SongCatalog | null>(null)
  const [loadError, setLoadError] = useState('')
  const [selectedID, setSelectedID] = useState<string | null>(null)
  // 演奏中の曲と譜面（null なら演奏していない）
  const [playing, setPlaying] = useState<{ songID: string; arrangementID: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [devices, setDevices] = useState<MidiDevice[]>([])
  const [midiStatus, setMidiStatus] = useState<StartResult | 'idle'>('idle')

  const playingRef = useRef(playing)
  playingRef.current = playing

  const load = useCallback(() => {
    setLoadError('')
    loadCatalog().then(setCatalog, (e: unknown) => {
      setLoadError(e instanceof Error ? e.message : '曲の一覧を読めませんでした')
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 音源が使えなくなったら（AudioContext が closed など）幕に戻す。演奏中なら、その曲の詳細を開いたホームに戻してから出す
  useEffect(() => {
    return audioEngine.onReadyChange((r) => {
      if (r) return
      const current = playingRef.current
      if (current) setSelectedID(current.songID)
      setPlaying(null)
      setReady(false)
    })
  }, [])

  // 幕を抜けたら機器の抜き差しを購読する
  useEffect(() => {
    if (!ready) return
    setDevices(midi.devices())
    const off = midi.onDevicesChange((list) => setDevices(list))
    return off
  }, [ready])

  // 画面が裏に回ったら試聴を止める
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') preview.stop()
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  if (!ready) {
    return (
      <StartGate
        midi={midi}
        onReady={(midiResult) => {
          // 結果は幕のタップの中で始めた start のもの。ここでは start を呼び直さない
          void midiResult.then(setMidiStatus, () => setMidiStatus('failed'))
          setReady(true)
        }}
      />
    )
  }

  if (loadError) {
    return (
      <div className="app__message">
        <p>{loadError}</p>
        <button type="button" className="app__retry" onClick={load}>
          もう一度読む
        </button>
      </div>
    )
  }
  if (!catalog) return <p className="app__message">曲を読み込んでいます…</p>

  const selected = selectedID ? catalog.song(selectedID) : undefined

  const playingSong = playing ? catalog.song(playing.songID) : undefined
  const sheet = settingsOpen && (
    <SettingsSheet
      settings={settings}
      devices={devices}
      midiStatus={midiStatus}
      resolvedKeyCount={keyCount(resolveKeyRange(midi.connectedDeviceNames(), settings.keyRange)) === 25 ? 25 : 13}
      onClose={() => setSettingsOpen(false)}
    />
  )

  if (playing && playingSong) {
    return (
      <>
        <PlayView
          key={`${playing.songID}/${playing.arrangementID}`}
          song={playingSong}
          arrangementID={playing.arrangementID}
          midi={midi}
          settings={settings}
          onBack={() => setPlaying(null)}
          onOpenSettings={() => setSettingsOpen(true)}
          settingsOpen={settingsOpen}
          onStarted={() => history.record(playing.songID, playing.arrangementID)}
        />
        {sheet}
      </>
    )
  }

  return (
    <>
      <Home
        catalog={catalog}
        preview={preview}
        history={history}
        onSelect={setSelectedID}
        header={
          <div className="app__header">
            <button type="button" className="app__gear" aria-label="設定" onClick={() => setSettingsOpen(true)}>
              ⚙
            </button>
          </div>
        }
      />
      {selected && (
        <SongDetail
          key={selected.id}
          song={selected}
          settings={settings}
          preview={preview}
          onClose={() => setSelectedID(null)}
          onPlay={(songID, arrangementID) => {
            preview.stop()
            setPlaying({ songID, arrangementID })
          }}
        />
      )}
      {sheet}
    </>
  )
}
