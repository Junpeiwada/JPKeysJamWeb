// 鍵盤（手本: JPKeyboardUI の KeyboardView）。描画は keyboardPaint.ts（iOS の Canvas の描画の移植）。
// 外枠は溝の色で KEYBOARD_OUTSET の余白を取り、親（PlayView）がその分を左右へはみ出させて、鍵の端をロールの端にそろえる。
// 複数の指（Pointer Events）で弾ける。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { whiteKeyCount } from '../guide/keyRange'
import { keyboardGeometry } from '../guide/rollLayout'
import { hitNote } from './keyboardHit'
import { paintKeyboard } from './keyboardPaint'
import './Keyboard.css'

/** 鍵盤の外枠の余白（px）。iOS の KeyboardView.keyboardInset と同じ */
export const KEYBOARD_OUTSET = 3

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
  onNoteOn(note: number): void
  onNoteOff(note: number): void
}

export function Keyboard(props: KeyboardProps): ReactElement {
  const { lowest, highest, pressed, guideNotes, wrongNotes } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 })
  // 指の ID → その指が今押さえている鍵
  const fingers = useRef(new Map<number, number>())
  // コールバックは最新を ref 経由で呼ぶ（再描画のたびに付け替えない）
  const callbacks = useRef({ onNoteOn: props.onNoteOn, onNoteOff: props.onNoteOff })
  callbacks.current = { onNoteOn: props.onNoteOn, onNoteOff: props.onNoteOff }

  const geometry = useMemo(() => keyboardGeometry(lowest, whiteKeyCount({ lowest, highest })), [lowest, highest])

  // canvas の大きさを親に合わせる（devicePixelRatio を掛けて鮮明に描く）
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const measure = () => {
      const box = canvas.getBoundingClientRect()
      setSize({ width: box.width, height: box.height, dpr: window.devicePixelRatio || 1 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // 描く
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width <= 0 || size.height <= 0) return
    const pixelWidth = Math.round(size.width * size.dpr)
    const pixelHeight = Math.round(size.height * size.dpr)
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
    const fontFamily = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif'
    paintKeyboard(ctx, size.width, size.height, geometry, pressed, guideNotes, wrongNotes, fontFamily)
  }, [size, geometry, pressed, guideNotes, wrongNotes])

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

  // 座標は内側の canvas（鍵の並び）を基準にする。外枠の余白は端の鍵に丸める
  const noteAt = (event: ReactPointerEvent): number | null => {
    const box = canvasRef.current?.getBoundingClientRect()
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

  return (
    <div
      className="kb-root"
      role="group"
      aria-label="鍵盤"
      style={{ padding: KEYBOARD_OUTSET }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      <canvas ref={canvasRef} className="kb-canvas" />
    </div>
  )
}
