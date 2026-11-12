// 鍵盤（手本: JPKeyboardUI の KeyboardView）。鍵の位置は rollLayout.keyRects で、ロールと同じ列にそろえる。
// 複数の指（Pointer Events）で弾ける。色は styles.css の変数だけを使う。
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { whiteKeyCount } from '../guide/keyRange'
import { boundaryX, keyboardGeometry, keyRects, type KeyRect } from '../guide/rollLayout'
import { hitNote } from './keyboardHit'
import './Keyboard.css'

export interface KeyboardProps {
  /** KeyRange の両端 */
  lowest: number
  highest: number
  /** 押している鍵（画面＋外部 MIDI） */
  pressed: ReadonlySet<number>
  /** 次に押す鍵。白鍵はライム、黒鍵は青 */
  guideNotes: ReadonlySet<number>
  /** 違う鍵（押している鍵と同じグレーで描く） */
  wrongNotes: ReadonlySet<number>
  /** 25 鍵の両手のとき 60。その白鍵の左に破線を引く。無ければ破線なし */
  splitNote?: number | null
  onNoteOn(note: number): void
  onNoteOff(note: number): void
}

/** C の白鍵に出す音名（C4 など） */
function cLabel(note: number): string {
  return `C${Math.floor(note / 12) - 1}`
}

function faceClass(note: number, pressed: ReadonlySet<number>, wrong: ReadonlySet<number>, guide: ReadonlySet<number>): string {
  if (pressed.has(note) || wrong.has(note)) return 'key-pressed'
  if (guide.has(note)) return 'key-guide'
  return 'key-normal'
}

export function Keyboard(props: KeyboardProps): ReactElement {
  const { lowest, highest, pressed, guideNotes, wrongNotes, splitNote } = props
  const rootRef = useRef<HTMLDivElement>(null)
  // 指の ID → その指が今押さえている鍵
  const fingers = useRef(new Map<number, number>())
  // コールバックは最新を ref 経由で呼ぶ（再描画のたびに付け替えない）
  const callbacks = useRef({ onNoteOn: props.onNoteOn, onNoteOff: props.onNoteOff })
  callbacks.current = { onNoteOn: props.onNoteOn, onNoteOff: props.onNoteOff }

  const geometry = useMemo(() => keyboardGeometry(lowest, whiteKeyCount({ lowest, highest })), [lowest, highest])
  // 鍵の位置は幅 100 に対する割合（%）で出す
  const rects = useMemo(() => keyRects(geometry, 100), [geometry])
  const whites = rects.filter((r) => !r.black)
  const blacks = rects.filter((r) => r.black)
  const splitX = splitNote == null ? null : boundaryX(splitNote, geometry.whiteNotes, 100)

  const heldBy = (note: number): boolean => {
    for (const n of fingers.current.values()) if (n === note) return true
    return false
  }

  /** 指がその鍵へ触れた。ほかの指が押さえている鍵は鳴らし直さない */
  const began = (id: number, note: number): void => {
    const already = heldBy(note)
    fingers.current.set(id, note)
    if (!already) callbacks.current.onNoteOn(note)
  }

  /** 指が離れた。ほかの指が残っている鍵は止めない */
  const ended = (id: number): void => {
    const note = fingers.current.get(id)
    if (note === undefined) return
    fingers.current.delete(id)
    if (!heldBy(note)) callbacks.current.onNoteOff(note)
  }

  const noteAt = (event: ReactPointerEvent): number | null => {
    const box = rootRef.current?.getBoundingClientRect()
    if (!box) return null
    return hitNote(geometry, event.clientX - box.left, event.clientY - box.top, box.width, box.height)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // マウスの右・中クリックでは鳴らさない
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    // 指が鍵盤の外へ出ても動きと離しを受け取る
    event.currentTarget.setPointerCapture(event.pointerId)
    const note = noteAt(event)
    if (note !== null) began(event.pointerId, note)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const previous = fingers.current.get(event.pointerId)
    // 押していない指（マウスのホバーなど）は無視する
    if (previous === undefined) return
    const note = noteAt(event)
    if (note === null || note === previous) return
    ended(event.pointerId)
    began(event.pointerId, note)
  }

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    ended(event.pointerId)
  }

  // 範囲が変わって弾けなくなった鍵、アンマウントのとき、押している指の音を止める
  useEffect(() => {
    const held = fingers.current
    const cb = callbacks
    return () => {
      const notes = new Set(held.values())
      held.clear()
      for (const note of notes) cb.current.onNoteOff(note)
    }
  }, [geometry])

  const renderKey = (rect: KeyRect): ReactElement => (
    <div
      key={rect.note}
      className={`kb-key ${rect.black ? 'kb-black' : 'kb-white'} ${faceClass(rect.note, pressed, wrongNotes, guideNotes)}`}
      style={{ left: `${rect.x}%`, width: `${rect.width}%` }}
    >
      <div className="kb-face">
        {!rect.black && rect.note % 12 === 0 && <span className="kb-label">{cLabel(rect.note)}</span>}
      </div>
    </div>
  )

  return (
    <div
      ref={rootRef}
      className="kb-root"
      role="group"
      aria-label="鍵盤"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      {whites.map(renderKey)}
      {blacks.map(renderKey)}
      {splitX !== null && <div className="kb-split" style={{ left: `${splitX}%` }} />}
    </div>
  )
}
