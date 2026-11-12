// 演奏画面（手本: App/Views/PlayView.swift）。
// 横: 上の帯（左に戻る・鍵盤数・手、真ん中に最初から・自動演奏、右に MIDI の点・設定）、進み具合、ロール（左上に曲名）、鍵盤、下にロゴ。
// 縦: 帯（戻る・再生の操作・点・設定）、進み具合、鍵盤数・手、ロール、鍵盤。音色（サウンド）は Web 版に無い。
// 入力（Web MIDI・画面の鍵盤）は GuideController.handleInput へ渡し、判定と音は controller が決める。
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from 'react'
import { GuideController } from '../audio/accompaniment'
import { audioEngine } from '../audio/engine'
import { GuideScore } from '../guide/guideScore'
import type { GuideSnapshot } from '../guide/guideSession'
import { PLAY_HANDS } from '../guide/hand'
import type { PlayHands } from '../guide/hand'
import { resolve as resolveKeyRange, whiteKeyCount } from '../guide/keyRange'
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
import { KEYBOARD_OUTSET, Keyboard } from './Keyboard'
import { BackwardEndFill, BrandLogo, ChevronDown, Gearshape, PauseFill, PlayFill } from './icons'
import {
  KEY_LAYOUT_OPTIONS,
  displayedHands,
  guideNotesForSounding,
  guideNotesForStep,
  handIsSelectable,
  handsName,
  isLandscape,
  keyLayoutLabel,
  keyLayoutOf,
  keyboardAllowsBothHands,
  keyboardHeight,
  logoGlyphHeight,
  progressFraction,
  progressText,
  rollHands,
  shouldReportStart,
  snapshotsEqual,
  stepAtFraction,
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

/** 画面の左右の余白（手本: PlayView.margin） */
const MARGIN = 16
/** 鍵盤の下に空けるすき間（手本: AppSettings の鍵盤の位置の既定。横 12・縦 30） */
const KEYBOARD_LIFT = { landscape: 12, portrait: 30 } as const
/**
 * 下のセーフエリアの代わりに空ける高さ。iOS はホームバーの分（横 21pt）を空け、そこにロゴを出す。
 * Android のジェスチャーの帯の近くを触って誤作動しないよう、Web でも同じだけ空ける
 */
const BOTTOM_INSET = 21

/**
 * 演奏画面の大きさ（セーフエリアの内側）。向きと鍵盤の高さを決める。
 * 測る要素は曲を読み込んだあとに出てくるので、callback ref で要素が付いた時点から見張る
 */
function useViewSize(): [(el: HTMLDivElement | null) => void, { width: number; height: number }] {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, size]
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

/** ボタン（チップ）から出す吹き出し。ボタンの真下に出し、外を押すか Esc で閉じる。選択肢は横に並べる（手本: keyLayoutPicker・handsPicker） */
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
        className="play-chip"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {props.label}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="play-popover" role="listbox" aria-label={props.ariaLabel}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** 吹き出しの選択肢の 1 つ。選んでいるものは太字にし、文字の左にチェックを付ける（手本: dropdownOptionLabel） */
function DropdownOption(props: { selected: boolean; disabled?: boolean; onSelect(): void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      disabled={props.disabled}
      className={`play-option ${props.selected ? 'selected' : ''}`}
      onClick={props.onSelect}
    >
      {props.selected && (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="play-option-check">
          <path d="M2.5 8.5 L6.5 12.5 L13.5 3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {props.children}
    </button>
  )
}

export function PlayView(props: PlayViewProps): ReactElement {
  const { song, arrangementID, midi, settings, onBack, onOpenSettings, settingsOpen } = props
  const loaded = useSmf(song, arrangementID)
  const [rootRef, viewSize] = useViewSize()
  const landscape = isLandscape(viewSize.width, viewSize.height)
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
  // 自動演奏中は次のステップではなく、伴奏の位置で鳴っている音を光らせる
  const guideNotes = !snapshot
    ? new Set<number>()
    : snapshot.autoplay !== 'off' && score && controller
      ? guideNotesForSounding(score.soundingNotes(controller.player.position), snapshot.hands, range)
      : guideNotesForStep(step, snapshot, range)
  const shownHands = displayedHands(handsSetting, hasLeftPart, allowsBoth)
  const done = snapshot?.stepIndex ?? 0
  const total = snapshot?.stepCount ?? 0
  const connected = deviceNames.length > 0
  const autoplaying = snapshot?.autoplay === 'playing'

  // 鍵盤の高さとロゴ（手本: PlayView.content）
  const lift = landscape ? KEYBOARD_LIFT.landscape : KEYBOARD_LIFT.portrait
  // iOS は下のセーフエリア（ホームバー）を除いた高さで決める。Web はその代わりに空ける BOTTOM_INSET を除く
  const kbHeight = keyboardHeight(
    viewSize.width,
    viewSize.height - BOTTOM_INSET,
    landscape,
    viewSize.width - MARGIN * 2,
    whiteKeyCount(range),
  )
  const logoRoom = 8 + lift + BOTTOM_INSET
  const glyphHeight = logoGlyphHeight(logoRoom, viewSize.width)

  const restart = () => controller?.restart()
  const toggleAutoplay = () => {
    if (!controller || !snapshot) return
    if (autoplaying) {
      controller.guide.stopAutomatically()
      return
    }
    // 弾き終えてカードが出ていたら、最初からやり直して流す
    if (snapshot.isComplete) controller.restart()
    controller.guide.playAutomatically()
  }

  // 進み具合のバー: タップかドラッグでそのステップへ移る（同じステップには移り直さない）
  const seekFromBar = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!controller || total <= 0) return
    const box = event.currentTarget.getBoundingClientRect()
    const target = stepAtFraction((event.clientX - box.left) / box.width, total)
    if (target !== controller.guide.snapshot().stepIndex) controller.guide.seek(target)
  }

  const backButton = (
    <button type="button" className="play-back" onClick={onBack} aria-label="曲に戻る">
      ‹ 戻る
    </button>
  )
  const keyLayoutButton = (
    <Dropdown label={keyLayoutLabel(range)} ariaLabel="鍵盤数">
      {(close) => (
        <>
          {KEY_LAYOUT_OPTIONS.map((o) => (
            <DropdownOption
              key={o.value}
              selected={o.value === keyLayoutOf(range)}
              onSelect={() => {
                settings.keyRange = o.value
                close()
              }}
            >
              {o.label}
            </DropdownOption>
          ))}
        </>
      )}
    </Dropdown>
  )
  const handsButton = hasLeftPart && (
    <Dropdown label={handsName(shownHands)} ariaLabel="弾く手">
      {(close) => (
        <>
          {PLAY_HANDS.map((h: PlayHands) => (
            <DropdownOption
              key={h}
              selected={h === shownHands}
              disabled={!handIsSelectable(h, allowsBoth)}
              onSelect={() => {
                settings.hands = h
                close()
              }}
            >
              {handsName(h)}
            </DropdownOption>
          ))}
        </>
      )}
    </Dropdown>
  )
  const transport = (
    <div className="play-transport">
      <button type="button" className="play-icon" onClick={restart} aria-label="最初から">
        <BackwardEndFill size={15} />
      </button>
      <button type="button" className="play-icon" onClick={toggleAutoplay} aria-label={autoplaying ? '一時停止' : '自動演奏'}>
        {autoplaying ? <PauseFill size={15} /> : <PlayFill size={15} />}
      </button>
    </div>
  )
  const trailing = (
    <div className="play-trailing">
      <span className="play-badge" title={connected ? deviceNames.join(' / ') : 'MIDI 機器なし'}>
        <span className={`play-badge-dot ${connected ? 'connected' : ''}`} />
        {connected && <span className="play-badge-label">USB</span>}
        {deviceNames.length > 1 && <span className="play-badge-more">+{deviceNames.length - 1}</span>}
      </span>
      {onOpenSettings && (
        <button type="button" className="play-icon play-gear" onClick={onOpenSettings} aria-label="設定">
          <Gearshape size={22} />
        </button>
      )}
    </div>
  )

  return (
    <div ref={rootRef} className={`play-root ${landscape ? 'play-landscape' : 'play-portrait'}`}>
      <div
        className="play-content"
        style={{ padding: `8px ${MARGIN}px calc(${8 + lift}px + max(env(safe-area-inset-bottom), ${BOTTOM_INSET}px))` }}
      >
        {landscape ? (
          <header className="play-bar">
            <div className="play-leading">
              {backButton}
              {keyLayoutButton}
              {handsButton}
            </div>
            {transport}
            {trailing}
          </header>
        ) : (
          <header className="play-bar">
            <div className="play-leading">{backButton}</div>
            {transport}
            {trailing}
          </header>
        )}

        <div className="play-progress">
          <div
            className="play-progress-hit"
            role="progressbar"
            aria-label="進み具合"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              seekFromBar(e)
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromBar(e)
            }}
          >
            <div className="play-progress-track">
              <div className="play-progress-fill" style={{ width: `${progressFraction(done, total) * 100}%` }} />
            </div>
          </div>
          <span className="play-progress-text">{progressText(done, total)}</span>
        </div>

        {!landscape && (
          <div className="play-controls">
            {keyLayoutButton}
            {handsButton}
          </div>
        )}

        {/* ロールと鍵盤は隙間なく重ねる。判定線が鍵盤の上端に接する */}
        <div className="play-surface">
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
            <span className="play-roll-title">{title}</span>
          </div>
          {/* 鍵盤の外枠の余白を左右へはみ出させ、鍵の端をロールの端にそろえる */}
          <div className="play-keyboard" style={{ height: kbHeight, margin: `0 ${-KEYBOARD_OUTSET}px` }}>
            <Keyboard
              lowest={range.lowest}
              highest={range.highest}
              pressed={pressed}
              guideNotes={guideNotes}
              wrongNotes={snapshot?.wrongHeldNotes ?? new Set<number>()}
              onNoteOn={(n) => screenInput('noteOn', n)}
              onNoteOff={(n) => screenInput('noteOff', n)}
            />
          </div>
        </div>
      </div>

      {/* 鍵盤の下のすき間に薄くロゴを出す。小さすぎるときは出さない */}
      {glyphHeight !== null && (
        <div className="play-logo" style={{ height: logoRoom }}>
          <BrandLogo glyphHeight={glyphHeight} />
        </div>
      )}

      {snapshot?.isComplete && (
        <FinishCard
          songTitle={title}
          elapsed={snapshot.elapsed}
          wrongCount={snapshot.wrongCount}
          onRetry={restart}
          onBackToList={onBack}
        />
      )}
    </div>
  )
}
