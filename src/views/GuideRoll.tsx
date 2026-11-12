// 鍵盤の真上に置くロール（手本: App/Views/GuideRoll.swift の描画部分）。
// 次のステップが判定線で待つ。棒は鍵と同じ列で、白鍵ならライム、黒鍵なら青。配置の計算は rollLayout.ts。
import { useEffect, useRef, type ReactElement } from 'react'
import type { GuideScore } from '../guide/guideScore'
import type { GuideSnapshot } from '../guide/guideSession'
import {
  NOTE_NAMES,
  approach as approachOf,
  barOpacity,
  barStepsAhead,
  blend,
  boundaryX,
  columnsFromGeometry,
  displayedStepsAhead,
  fadeProgress as fadeProgressOf,
  fades,
  firstVisibleIndex,
  isBlack,
  isCollected,
  judgeY,
  keyboardGeometry,
  labelOpacity,
  lastVisibleTime,
  resolveInColumns,
  showsLabels,
  vertical,
  zones,
  KEYBOARD_INSET,
  type Column,
  type GuideRollHands,
  type Progress,
  type Zone,
} from '../guide/rollLayout'
import { whiteKeyCount } from '../guide/keyRange'
import { tone, toCssColor } from '../theme'
import './GuideRoll.css'

export interface GuideRollProps {
  score: GuideScore
  snapshot: GuideSnapshot
  /** 伴奏（SmfPlayer）の位置（秒）。描画のフレームごとに呼ぶ */
  position: () => number
  lowest: number
  highest: number
  hands: GuideRollHands
}

// canvas は CSS 変数を使えないので、theme.ts の値から作る
const color = {
  panel: toCssColor(tone.panel),
  panel2: toCssColor(tone.panel2),
  sub: toCssColor(tone.sub),
  text: toCssColor(tone.text),
  accent: toCssColor(tone.accent),
  blackAccent: toCssColor(tone.blackAccent),
}

/** ロールの上の角丸の半径 */
const GROUND_RADIUS = 10
/** 棒の角丸の半径 */
const BAR_RADIUS = 6
/** 区切り線の上端（地の角丸の分あける） */
const TOP_INSET = 8

/** 棒 1 本の見た目。フェード中は前の濃さと今の濃さを混ぜる */
interface BarLook {
  isNext: boolean
  opacity: number
  labelOpacity: number
}

function barLook(
  note: number,
  left: boolean,
  index: number,
  approach: number,
  current: Progress,
  previous: Progress | null,
  fadeProgress: number,
  keepsPlayed: boolean,
): BarLook {
  const stepsAheadIn = (state: Progress): number =>
    displayedStepsAhead(barStepsAhead(index - state.stepIndex, isCollected(state, note, left)), keepsPlayed)
  const stepsAhead = stepsAheadIn(current)
  const from = previous ? stepsAheadIn(previous) : stepsAhead
  return {
    isNext: stepsAhead === 0 && approach >= 1,
    // 弾く棒が明るくなるのはフェードせず即座に（済んだ棒が消えるのだけフェードする）
    opacity: blend(barOpacity(from, approach), barOpacity(stepsAhead, approach), stepsAhead === 0 ? 1 : fadeProgress),
    labelOpacity: blend(labelOpacity(from), labelOpacity(stepsAhead), fadeProgress),
  }
}

/** 角丸の長方形の経路（canvas の roundRect に頼らない） */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 描画に使う、プロパティから決まる値 */
interface Frame {
  props: GuideRollProps
}

export function GuideRoll(props: GuideRollProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // フレームごとの描画が最新のプロパティを読めるようにする
  const latest = useRef<Frame>({ props })
  latest.current = { props }

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !root || !ctx) return

    let width = 0
    let height = 0
    let dpr = 1
    const resize = (): void => {
      const box = root.getBoundingClientRect()
      dpr = window.devicePixelRatio || 1
      width = box.width
      height = box.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(root)

    // 押した音名の変化に合わせたフェードの状態。previous はその前の状態
    let shown: Progress | null = null
    let fade: { previous: Progress; start: number } | null = null

    let frame = 0
    const loop = (now: number): void => {
      const { props: p } = latest.current
      const finished = p.snapshot.isFinished
      const progress: Progress = {
        stepIndex: finished ? Math.max(p.snapshot.stepIndex, p.score.steps.length) : p.snapshot.stepIndex,
        collectedMask: p.snapshot.collectedMask,
        collectedLeftMask: p.snapshot.collectedLeftMask,
      }
      if (shown !== null && fades(shown, progress)) fade = { previous: shown, start: now }
      else if (shown !== null && (shown.stepIndex !== progress.stepIndex
        || shown.collectedMask !== progress.collectedMask
        || shown.collectedLeftMask !== progress.collectedLeftMask)) fade = null
      shown = progress
      let fadeProgress = 1
      if (fade) {
        fadeProgress = fadeProgressOf((now - fade.start) / 1000)
        if (fadeProgress >= 1) fade = null
      }
      draw(ctx, width, height, dpr, p, progress, fade && fadeProgress < 1 ? fade.previous : null, fadeProgress)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return (
    <div ref={rootRef} className="guide-roll-root">
      <canvas ref={canvasRef} className="guide-roll" aria-hidden="true" />
    </div>
  )
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  p: GuideRollProps,
  current: Progress,
  previous: Progress | null,
  fadeProgress: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (width <= 0 || height <= 0) return

  const geometry = keyboardGeometry(p.lowest, whiteKeyCount({ lowest: p.lowest, highest: p.highest }))
  const whites = geometry.whiteNotes
  const columns = columnsFromGeometry(geometry, width)

  // 地。下は鍵盤にくっつくので、角丸は上だけ
  ctx.fillStyle = color.panel
  ctx.beginPath()
  ctx.moveTo(0, height)
  ctx.lineTo(0, GROUND_RADIUS)
  ctx.arcTo(0, 0, GROUND_RADIUS, 0, GROUND_RADIUS)
  ctx.lineTo(width - GROUND_RADIUS, 0)
  ctx.arcTo(width, 0, width, GROUND_RADIUS, GROUND_RADIUS)
  ctx.lineTo(width, height)
  ctx.closePath()
  ctx.fill()

  // 黒鍵の列。黒鍵と同じ幅の帯を敷き、どの列が黒鍵かを見分けやすくする
  ctx.globalAlpha = 0.5
  ctx.fillStyle = color.panel2
  for (const [note, column] of columns) {
    if (!isBlack(note)) continue
    ctx.fillRect(column.centerX - column.width / 2, TOP_INSET, column.width, Math.max(0, height - TOP_INSET))
  }
  ctx.globalAlpha = 1

  // 白鍵の境目
  if (whites.length > 1) {
    const whiteW = (width - KEYBOARD_INSET * 2) / whites.length
    ctx.strokeStyle = color.panel2
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < whites.length; i += 1) {
      const x = KEYBOARD_INSET + whiteW * i
      ctx.moveTo(x, TOP_INSET)
      ctx.lineTo(x, height)
    }
    ctx.stroke()
  }

  // 両手の境目（破線）
  if (p.hands.kind === 'split') {
    const x = boundaryX(p.hands.lowestRight, whites, width)
    if (x !== null) {
      ctx.strokeStyle = color.sub
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(x, TOP_INSET)
      ctx.lineTo(x, height)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // 判定線
  const judge = judgeY(height)
  ctx.strokeStyle = color.accent
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, judge)
  ctx.lineTo(width, judge)
  ctx.stroke()

  // 見えている範囲のステップだけを描く
  const position = p.position()
  const steps = p.score.steps
  const keepsPlayed = p.snapshot.autoplay !== 'off'
  const handZones = zones(p.hands, p.lowest, p.highest)
  const labels = showsLabels(columns)
  const start = firstVisibleIndex(p.score.times, p.score.longestLength, position, height)
  const lastTime = lastVisibleTime(position, height)
  for (let index = start; index < steps.length && steps[index].time <= lastTime; index += 1) {
    const step = steps[index]
    const { top, bottom } = vertical(step.time, step.endTime, position, height)
    // 上端が画面の下に抜けた棒は描かない
    if (top >= height) continue
    const approach = approachOf(step.time, position)
    const look = (note: number, left: boolean): BarLook =>
      barLook(note, left, index, approach, current, previous, fadeProgress, keepsPlayed)
    // 右手の音は collectedMask、左手の音は collectedLeftMask で押したかを見る
    if (handZones.right) drawBars(ctx, step.notes, handZones.right, columns, top, bottom, labels, (n) => look(n, false))
    if (handZones.left) drawBars(ctx, step.leftNotes, handZones.left, columns, top, bottom, labels, (n) => look(n, true))
  }
}

/** 区域に振り替えた音の棒を描く。手は区域（位置）で分かるので、色は白鍵か黒鍵かで決める */
function drawBars(
  ctx: CanvasRenderingContext2D,
  notes: readonly number[],
  zone: Zone,
  columns: ReadonlyMap<number, Column>,
  top: number,
  bottom: number,
  labels: boolean,
  lookFor: (note: number) => BarLook,
): void {
  // 同じ列に振り替わった音は 1 本にする
  const resolved = new Set<number>()
  for (const note of notes) {
    const r = resolveInColumns(note, columns, zone.lowest, zone.highest)
    if (r !== null) resolved.add(r)
  }
  // 隣り合う白鍵と黒鍵の棒は重なるので、白鍵の棒を先に描いて黒鍵の棒を上に載せる
  const ordered = [...resolved].sort((a, b) => Number(isBlack(a)) - Number(isBlack(b)))
  for (const note of ordered) {
    const column = columns.get(note)
    if (!column) continue
    const look = lookFor(note)
    ctx.globalAlpha = look.opacity
    ctx.fillStyle = isBlack(note) ? color.blackAccent : color.accent
    roundedRect(ctx, column.centerX - column.width / 2, top, column.width, bottom - top, BAR_RADIUS)
    ctx.fill()
    if (!labels) continue
    // 次の棒（まだ押していない音名）は音名を太くする
    ctx.globalAlpha = look.labelOpacity
    ctx.fillStyle = color.text
    ctx.font = `${look.isNext ? 'bold' : 'normal'} 12px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(NOTE_NAMES[note % 12], column.centerX, bottom - 9)
  }
  ctx.globalAlpha = 1
}
