// 演奏画面（手本: App/Views/PlayView.swift）。
// 上の帯 1 行（戻る・曲名・最初から・手・鍵盤数・MIDI バッジ・設定）、進み具合、ロール、鍵盤。
// 入力（Web MIDI・画面の鍵盤）は GuideController.handleInput へ渡し、判定と音は controller が決める。
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { GuideController } from '../audio/accompaniment'
import { audioEngine } from '../audio/engine'
import { GuideScore } from '../guide/guideScore'
import type { GuideSnapshot } from '../guide/guideSession'
import { PLAY_HANDS } from '../guide/hand'
import type { PlayHands } from '../guide/hand'
import { resolve as resolveKeyRange } from '../guide/keyRange'
import type { KeyRange } from '../guide/keyRange'
import { localizedText } from '../library/catalog'
import type { SongEntry } from '../library/catalog'
import type { AppSettings } from '../library/settings'
import { parseSmf } from '../midi/smf'
import type { SmfSong } from '../midi/smf'
import type { MidiMessage } from '../midi/types'
import type { WebMidiInput } from '../midi/webMidi'
import { FinishCard } from './FinishCard'
import { GuideRoll } from './GuideRoll'
import { Keyboard } from './Keyboard'
import {
  KEY_LAYOUT_OPTIONS,
  LOWEST_RIGHT_NOTE,
  displayedHands,
  guideNotesForStep,
  handIsSelectable,
  handsName,
  isLandscape,
  keyLayoutLabel,
  keyLayoutOf,
  keyboardAllowsBothHands,
  progressFraction,
  progressText,
  rollHands,
  shouldReportStart,
  snapshotsEqual,
} from './playViewLogic'
import './PlayView.css'

export interface PlayViewProps {
  song: SongEntry
  arrangementID: string
  midi: WebMidiInput
  settings: AppSettings
  /** 戻る・弾き終わりの「曲に戻る」 */
  onBack(): void
  /** 無ければ設定ボタンは出さない */
  onOpenSettings?(): void
  /** 設定シートを開いている間は true（曲を止める） */
  settingsOpen?: boolean
  /** 演奏を始めたとき（履歴の記録用） */
  onStarted?(): void
}

/** 画面の鍵盤で弾いたときの強さ */
const SCREEN_VELOCITY = 100

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; smf: SmfSong }

/** 曲データを読む。song・arrangementID が変わったら読み直す */
function useSmf(song: SongEntry, arrangementID: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ status: 'loading' })
    const arrangement = song.arrangements.find((a) => a.id === arrangementID) ?? song.arrangements[0]
    if (!arrangement) {
      setLoaded({ status: 'error' })
      return
    }
    fetch(`${import.meta.env.BASE_URL}songs/${arrangement.file}`, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        if (!abort.signal.aborted) setLoaded({ status: 'ready', smf: parseSmf(new Uint8Array(buf)) })
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoaded({ status: 'error' })
      })
    return () => abort.abort()
  }, [song, arrangementID])
  return loaded
}

/** 画面の幅と高さから横画面かを決める */
function useLandscape(): boolean {
  const [landscape, setLandscape] = useState(() => isLandscape(window.innerWidth, window.innerHeight))
  useEffect(() => {
    const update = () => setLandscape(isLandscape(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return landscape
}

/** 演奏中は画面をスリープさせない。裏から戻ったら取り直す。対応していなければ何もしない */
function useWakeLock(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let cancelled = false
    let sentinel: WakeLockSentinel | null = null
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock.request('screen').then(
        (s) => {
          if (cancelled) void s.release().catch(() => {})
          else sentinel = s
        },
        () => {},
      )
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
      sentinel = null
    }
  }, [])
}

/** ボタンから出す吹き出し。ボタンの真下に出し、外を押すか Esc で閉じる */
function Dropdown(props: { label: string; ariaLabel: string; children: (close: () => void) => ReactElement }): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="play-dropdown" ref={rootRef}>
      <button
        type="button"
        className="play-btn"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {props.label}
      </button>
      {open && (
        <div className="play-popover" role="listbox" aria-label={props.ariaLabel}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function PlayView(props: PlayViewProps): ReactElement {
  const { song, arrangementID, midi, settings, onBack, onOpenSettings, settingsOpen } = props
  const loaded = useSmf(song, arrangementID)
  const landscape = useLandscape()
  useWakeLock()

  // 設定
  const keyPref = useSyncExternalStore(
    (cb) => settings.subscribe(cb),
    () => settings.keyRange,
  )
  const handsSetting = useSyncExternalStore(
    (cb) => settings.subscribe(cb),
    () => settings.hands,
  )
  const oneNote = useSyncExternalStore(
    (cb) => settings.subscribe(cb),
    () => settings.oneNote,
  )

  // つながっている機器（抜き差しで鍵盤数を決め直す）
  const [deviceNames, setDeviceNames] = useState<string[]>(() => midi.connectedDeviceNames())
  useEffect(() => {
    setDeviceNames(midi.connectedDeviceNames())
    return midi.onDevicesChange(() => setDeviceNames(midi.connectedDeviceNames()))
  }, [midi])
  const range: KeyRange = useMemo(() => resolveKeyRange(deviceNames, keyPref), [deviceNames, keyPref])
  const allowsBoth = keyboardAllowsBothHands(range)

  const smf = loaded.status === 'ready' ? loaded.smf : null
  const hasLeftPart = useMemo(() => (smf ? GuideScore.hasNotes(smf, 1) : false), [smf])

  // controller は曲ごとに 1 つ。effect の cleanup で dispose する（StrictMode の 2 回目の effect でも作り直すだけ）
  const [controller, setController] = useState<GuideController | null>(null)
  const latest = useRef({ handsSetting, range, oneNote })
  latest.current = { handsSetting, range, oneNote }
  const reported = useRef(false)
  // 曲を止めている理由（設定シート・裏に回った）。両方外れたときだけ再開する
  const pauseReasons = useRef({ settings: false, hidden: false })
  const pausedByReasons = useRef(false)

  useEffect(() => {
    if (!smf) return
    const c = new GuideController({
      song: smf,
      hands: latest.current.handsSetting,
      keyRange: latest.current.range,
      oneNote: latest.current.oneNote,
    })
    c.start()
    reported.current = false
    pausedByReasons.current = false
    setController(c)
    return () => {
      c.dispose()
      setController(null)
    }
  }, [smf])

  // 設定の変更を演奏中も反映する
  useEffect(() => {
    controller?.setKeyRange(range)
  }, [controller, range])
  useEffect(() => {
    controller?.setHands(handsSetting)
  }, [controller, handsSetting])
  useEffect(() => {
    controller?.setOneNote(oneNote)
  }, [controller, oneNote])

  // 画面の更新: 毎フレーム snapshot を読み、中身が変わったときだけ state にする
  const [snapshot, setSnapshot] = useState<GuideSnapshot | null>(null)
  useEffect(() => {
    if (!controller) {
      setSnapshot(null)
      return
    }
    let frame = 0
    let last: GuideSnapshot | null = null
    const tick = () => {
      const next = controller.guide.snapshot()
      if (!snapshotsEqual(last, next)) {
        last = next
        setSnapshot(next)
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [controller])

  // 演奏の始まりを一度だけ知らせる
  const onStarted = props.onStarted
  useEffect(() => {
    if (snapshot && shouldReportStart(reported.current, snapshot.advancedSteps)) {
      reported.current = true
      onStarted?.()
    }
  }, [snapshot, onStarted])

  // 入力: 外部 MIDI。押している鍵は画面と外部の noteOn / noteOff から作る。
  // 画面の鍵盤と外部 MIDI で同じ鍵を押して片方を離すと、もう片方を押したままでも離した扱いになる。
  // 押下元を分けて数えない（仕様として受け入れる）。
  const [pressed, setPressed] = useState<ReadonlySet<number>>(new Set())
  const pressedRef = useRef(new Set<number>())
  const track = useCallback((message: MidiMessage) => {
    const set = pressedRef.current
    if (message.type === 'noteOn' && message.velocity > 0) {
      if (!set.has(message.note)) {
        set.add(message.note)
        setPressed(new Set(set))
      }
    } else if (message.type === 'noteOn' || message.type === 'noteOff') {
      if (set.delete(message.note)) setPressed(new Set(set))
    } else if (message.type === 'controlChange' && (message.controller === 120 || message.controller === 123)) {
      if (set.size > 0) {
        set.clear()
        setPressed(new Set())
      }
    }
  }, [])
  useEffect(() => {
    if (!controller) return
    return midi.onMessage((message) => {
      track(message)
      controller.handleInput(message)
    })
  }, [midi, controller, track])

  // 入力: 画面の鍵盤
  const screenInput = useCallback(
    (type: 'noteOn' | 'noteOff', note: number) => {
      const message: MidiMessage = { type, channel: 0, note, velocity: type === 'noteOn' ? SCREEN_VELOCITY : 0 }
      track(message)
      controller?.handleInput(message)
    },
    [controller, track],
  )

  // 止める理由（設定シートを開いている・裏に回った）のどちらかがあれば一時停止し、両方外れたら再開する。
  // 弾き終えた（isComplete）あとは止めない・再開しない
  const syncPause = useCallback(() => {
    if (!controller) return
    const reasons = pauseReasons.current
    const needPause = reasons.settings || reasons.hidden
    if (needPause && !pausedByReasons.current) {
      if (controller.guide.snapshot().isComplete) return
      pausedByReasons.current = true
      controller.pause()
    } else if (!needPause && pausedByReasons.current) {
      pausedByReasons.current = false
      if (!controller.guide.snapshot().isComplete) controller.resume()
    }
  }, [controller])

  useEffect(() => {
    pauseReasons.current.settings = !!settingsOpen
    syncPause()
  }, [settingsOpen, syncPause])

  // 裏に回ったら伴奏を止めて一時停止し、戻ったら続ける
  useEffect(() => {
    if (!controller) return
    let disposed = false
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        pauseReasons.current.hidden = true
        syncPause()
        void audioEngine.suspend().catch(() => {})
      } else {
        pauseReasons.current.hidden = false
        void audioEngine
          .resume()
          .catch(() => {})
          .then(() => {
            // 待っている間にまた裏に回ったときは再開しない
            if (disposed || document.visibilityState !== 'visible') return
            syncPause()
          })
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [controller, syncPause])

  const title = localizedText(song.title, 'ja')

  if (loaded.status !== 'ready') {
    return (
      <div className="play-root play-message">
        <p>{loaded.status === 'loading' ? '曲を読み込んでいます…' : '曲を読み込めませんでした'}</p>
        <button type="button" className="play-btn" onClick={onBack}>
          戻る
        </button>
      </div>
    )
  }

  const score = controller && snapshot ? controller.guide.scoreFor(snapshot.hands) : null
  const step = score && snapshot ? score.steps[snapshot.stepIndex] : undefined
  const guideNotes = snapshot ? guideNotesForStep(step, snapshot, range) : new Set<number>()
  const shownHands = displayedHands(handsSetting, hasLeftPart, allowsBoth)
  const splitNote = snapshot?.hands === 'both' ? LOWEST_RIGHT_NOTE : null
  const done = snapshot?.stepIndex ?? 0
  const total = snapshot?.stepCount ?? 0
  const connected = deviceNames.length > 0

  return (
    <div className={`play-root ${landscape ? 'play-landscape' : 'play-portrait'}`}>
      <header className="play-bar">
        <button type="button" className="play-btn" onClick={onBack} aria-label="曲に戻る">
          戻る
        </button>
        <h1 className="play-title">{title}</h1>
        <div className="play-actions">
          <button type="button" className="play-btn" onClick={() => controller?.restart()}>
            最初から
          </button>
          {hasLeftPart && (
            <Dropdown label={handsName(shownHands)} ariaLabel="弾く手">
              {(close) => (
                <>
                  {PLAY_HANDS.map((h: PlayHands) => {
                    const selectable = handIsSelectable(h, allowsBoth)
                    return (
                      <button
                        key={h}
                        type="button"
                        role="option"
                        aria-selected={h === shownHands}
                        disabled={!selectable}
                        className={`play-option ${h === shownHands ? 'selected' : ''}`}
                        onClick={() => {
                          settings.hands = h
                          close()
                        }}
                      >
                        {handsName(h)}
                      </button>
                    )
                  })}
                </>
              )}
            </Dropdown>
          )}
          <Dropdown label={keyLayoutLabel(range)} ariaLabel="鍵盤数">
            {(close) => (
              <>
                {KEY_LAYOUT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={o.value === keyLayoutOf(range)}
                    className={`play-option ${o.value === keyLayoutOf(range) ? 'selected' : ''}`}
                    onClick={() => {
                      settings.keyRange = o.value
                      close()
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </>
            )}
          </Dropdown>
          <span className={`play-badge ${connected ? 'connected' : ''}`} title={deviceNames.join(' / ')}>
            {connected ? 'USB' : 'MIDI なし'}
          </span>
          {onOpenSettings && (
            <button type="button" className="play-btn" onClick={onOpenSettings} aria-label="設定">
              設定
            </button>
          )}
        </div>
      </header>

      <div className="play-progress" role="progressbar" aria-label="進み具合" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="play-progress-track">
          <div className="play-progress-fill" style={{ width: `${progressFraction(done, total) * 100}%` }} />
        </div>
        <span className="play-progress-text">{progressText(done, total)}</span>
      </div>

      <div className="play-roll">
        {controller && snapshot && score && (
          <GuideRoll
            score={score}
            snapshot={snapshot}
            position={() => controller.player.position}
            lowest={range.lowest}
            highest={range.highest}
            hands={rollHands(snapshot.hands)}
          />
        )}
      </div>

      <div className="play-keyboard">
        <Keyboard
          lowest={range.lowest}
          highest={range.highest}
          pressed={pressed}
          guideNotes={guideNotes}
          wrongNotes={snapshot?.wrongHeldNotes ?? new Set<number>()}
          splitNote={splitNote}
          onNoteOn={(n) => screenInput('noteOn', n)}
          onNoteOff={(n) => screenInput('noteOff', n)}
        />
      </div>

      {snapshot?.isComplete && (
        <FinishCard
          songTitle={title}
          elapsed={snapshot.elapsed}
          wrongCount={snapshot.wrongCount}
          onRetry={() => controller?.restart()}
          onBackToList={onBack}
        />
      )}
    </div>
  )
}
