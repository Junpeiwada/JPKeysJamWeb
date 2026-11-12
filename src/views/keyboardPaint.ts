// 鍵盤の描画。JPKeyboardUI の KeyboardView.swift（drawKeyboard・drawPressShade）と
// Theme.swift（KeycapFaces）を canvas に 1 対 1 で移したもの。色と形の値は theme.ts だけから取る。
// SwiftUI の continuous（なめらかな角丸）は、ふつうの円弧の角丸で近似する。
import { bevel, fillet, lip, mix, rim, tone, toCssColor } from '../theme'
import { BLACK_HEIGHT_RATIO, BLACK_WIDTH_RATIO, type KeyboardGeometry } from '../guide/rollLayout'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const maxX = (r: Rect) => r.x + r.w
const maxY = (r: Rect) => r.y + r.h
const midX = (r: Rect) => r.x + r.w / 2
const midY = (r: Rect) => r.y + r.h / 2

const WHITE = 0xffffff
const black = (opacity: number) => `rgba(0, 0, 0, ${opacity})`
const white = (opacity: number) => `rgba(255, 255, 255, ${opacity})`

/** 角丸の四角。squareTop なら奥側（上端）の角を直角にし、手前側の角だけ丸める */
function roundedRect(rect: Rect, radius: number, squareTop: boolean, dx = 0, dy = 0): Path2D {
  const path = new Path2D()
  const r = Math.max(0, Math.min(radius, rect.w / 2, rect.h / 2))
  path.roundRect(rect.x + dx, rect.y + dy, Math.max(0, rect.w), Math.max(0, rect.h), squareTop ? [0, 0, r, r] : r)
  return path
}

function linear(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  for (const [at, color] of stops) g.addColorStop(at, color)
  return g
}

/** キーキャップの 2 つの面。側面（外形）の内側に、手前の縁を厚く残して上面を置く（KeycapFaces） */
class KeycapFaces {
  readonly side: Path2D
  readonly top: Path2D
  readonly topRect: Rect
  readonly topRadius: number

  constructor(
    readonly rect: Rect,
    readonly options: { lipScale?: number; slopeGap?: number; squareTop?: boolean } = {},
  ) {
    const lipScale = options.lipScale ?? 1
    const slopeGap = options.slopeGap ?? 0
    const squareTop = options.squareTop ?? false
    const lipWidth = lip(rect.h) * lipScale + slopeGap
    const rimWidth = rim(rect.h)
    this.topRect = {
      x: rect.x + rimWidth,
      y: rect.y + rimWidth * 0.6,
      w: Math.max(0, rect.w - rimWidth * 2),
      h: Math.max(0, rect.h - rimWidth * 0.6 - lipWidth),
    }
    const r = fillet(rect.w, rect.h)
    this.topRadius = Math.max(0, r - rimWidth * 0.5)
    this.side = roundedRect(rect, r, squareTop)
    this.top = roundedRect(this.topRect, this.topRadius, squareTop)
  }

  get slopeGap(): number {
    return this.options.slopeGap ?? 0
  }

  /**
   * 側面・上面（奥が明るいグラデーション）・照り返しを描く。flat なら上面を単色で塗り照り返しも描かない。
   * crease なら上面と手前の縁の境目に暗い線（白鍵向け）、slope なら手前の縁を台形の斜面にする（黒鍵向け）。
   * sideTop を渡すと側面を上端 sideTop から下端 side へのグラデーションで塗る。sunk なら押し下げた鍵
   */
  draw(
    ctx: CanvasRenderingContext2D,
    colors: { top: number; side: number; sideTop?: number },
    flags: { flat?: boolean; crease?: boolean; slope?: boolean; sunk?: boolean } = {},
  ): void {
    const { rect, topRect } = this
    const { flat = false, crease = false, slope = false, sunk = false } = flags
    const topFill = linear(ctx, midX(topRect), topRect.y, midX(topRect), topRect.y + topRect.h * 0.6, [
      [0, toCssColor(mix(colors.top, WHITE, bevel.sheen))],
      [1, toCssColor(colors.top)],
    ])
    // 押し下げた鍵は側面も上面と同じに塗り、境目が筋に見えないようにする
    if (sunk && !flat) {
      ctx.fillStyle = topFill
    } else if (colors.sideTop !== undefined) {
      ctx.fillStyle = linear(ctx, midX(rect), rect.y, midX(rect), maxY(rect), [
        [0, toCssColor(colors.sideTop)],
        [1, toCssColor(colors.side)],
      ])
    } else {
      ctx.fillStyle = toCssColor(colors.side)
    }
    ctx.fill(this.side)

    if (slope) {
      const foot = rect.w * 0.07
      const f = fillet(topRect.w, topRect.h)
      const path = new Path2D()
      path.moveTo(topRect.x, maxY(topRect) - f)
      path.lineTo(maxX(topRect), maxY(topRect) - f)
      path.lineTo(maxX(rect) - foot, maxY(rect) - 1 - this.slopeGap)
      path.lineTo(rect.x + foot, maxY(rect) - 1 - this.slopeGap)
      path.closePath()
      ctx.fillStyle = linear(ctx, midX(rect), maxY(topRect), midX(rect), maxY(rect) - this.slopeGap, [
        [0, toCssColor(mix(colors.top, WHITE, bevel.blackSlopeLight))],
        [1, toCssColor(colors.side)],
      ])
      ctx.fill(path)
    }

    if (flat) {
      ctx.fillStyle = toCssColor(colors.top)
      ctx.fill(this.top)
      return
    }
    ctx.fillStyle = topFill
    ctx.fill(this.top)
    if (!sunk) {
      ctx.strokeStyle = linear(ctx, midX(topRect), topRect.y, midX(topRect), midY(topRect), [
        [0, white(bevel.highlight)],
        [1, white(0)],
      ])
      ctx.lineWidth = 0.75
      ctx.stroke(this.top)
    }
    if (!crease) return

    // 下端が最も濃く、角の丸みの 2 倍ほど上で消える
    const fade = fillet(topRect.w, topRect.h) * 2
    ctx.strokeStyle = linear(ctx, midX(topRect), maxY(topRect) - fade, midX(topRect), maxY(topRect), [
      [0, black(0)],
      [1, black(bevel.crease)],
    ])
    ctx.lineWidth = 1
    ctx.stroke(this.top)
    // 押し下げた鍵は境目の線だけにする
    if (sunk) return

    // 下端だけ太くする。上面を下へずらした形から上面を除いた三日月形を、下へ薄れるように塗る
    const band = new Path2D()
    band.addPath(roundedRect(topRect, this.topRadius, this.options.squareTop ?? false, 0, bevel.creaseWidth))
    band.addPath(this.top)
    ctx.save()
    const clip = new Path2D()
    clip.rect(topRect.x - 1, midY(topRect), topRect.w + 2, topRect.h)
    ctx.clip(clip)
    ctx.fillStyle = linear(ctx, midX(topRect), maxY(topRect), midX(topRect), maxY(topRect) + bevel.creaseWidth, [
      [0, black(bevel.crease)],
      [1, black(0)],
    ])
    ctx.fill(band, 'evenodd')
    ctx.restore()

    // 線のすぐ上のハイライト。角の丸みを除いたまっすぐな部分に横線 1 本
    const r = fillet(topRect.w, topRect.h)
    const shine: Rect = {
      x: topRect.x + r,
      y: maxY(topRect) - 0.5 - bevel.shineWidth,
      w: Math.max(0, topRect.w - r * 2),
      h: bevel.shineWidth,
    }
    ctx.fillStyle = linear(ctx, midX(shine), shine.y, midX(shine), maxY(shine), [
      [0, white(0)],
      [1, white(bevel.shine)],
    ])
    ctx.fillRect(shine.x, shine.y, shine.w, shine.h)
  }
}

/** 鍵の面の状態。押している鍵 ＞ 次に押す鍵 ＞ ふつう（KeyFaceState） */
export type KeyFaceState = 'normal' | 'guide' | 'pressed'

export function keyFaceState(
  note: number,
  pressed: ReadonlySet<number>,
  guide: ReadonlySet<number>,
  wrong: ReadonlySet<number>,
): KeyFaceState {
  if (pressed.has(note) || wrong.has(note)) return 'pressed'
  if (guide.has(note)) return 'guide'
  return 'normal'
}

/** 押している白鍵の奥の端と左の端に影を落とし、隣の鍵より低く沈んだように見せる（drawPressShade） */
function drawPressShade(ctx: CanvasRenderingContext2D, faces: KeycapFaces): void {
  const rect = faces.rect
  ctx.fillStyle = linear(ctx, midX(rect), rect.y, midX(rect), rect.y + rect.h * bevel.pressedShadeRatio, [
    [0, black(bevel.pressedShade)],
    [1, black(0)],
  ])
  ctx.fill(faces.side)
  ctx.fillStyle = linear(ctx, rect.x, midY(rect), rect.x + bevel.pressedSideShadeWidth, midY(rect), [
    [0, black(bevel.pressedSideShade)],
    [0.15, black(bevel.pressedSideShade * bevel.pressedSideShadeNear)],
    [0.4, black(bevel.pressedSideShade * bevel.pressedSideShadeFar)],
    [1, black(0)],
  ])
  ctx.fill(faces.side)
}

/** 鍵どうしの隙間（溝の色が見える） */
const KEY_GAP = 1.5

/** 鍵盤を描く（drawKeyboard）。width・height は CSS px（iOS の pt と同じ扱い） */
export function paintKeyboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  geometry: KeyboardGeometry,
  pressed: ReadonlySet<number>,
  guide: ReadonlySet<number>,
  wrong: ReadonlySet<number>,
  fontFamily: string,
): void {
  ctx.clearRect(0, 0, width, height)
  const whites = geometry.whiteNotes
  if (whites.length === 0 || width <= 0 || height <= 0) return
  const whiteW = width / whites.length

  whites.forEach((note, i) => {
    const rect: Rect = { x: i * whiteW + KEY_GAP / 2, y: 0, w: whiteW - KEY_GAP, h: height }
    const state = keyFaceState(note, pressed, guide, wrong)
    const isDown = state === 'pressed'
    const faces = new KeycapFaces(rect, { lipScale: isDown ? bevel.pressedLipScale : 1, squareTop: true })
    const top = state === 'pressed' ? tone.pressedTop : state === 'guide' ? tone.accent : tone.whiteTop
    faces.draw(ctx, { top, side: state === 'guide' ? tone.accentDeep : tone.whiteSide }, { crease: true, sunk: isDown })
    if (isDown) drawPressShade(ctx, faces)
    if (note % 12 === 0) {
      const size = Math.max(8, Math.min(11, whiteW * 0.28))
      ctx.font = `500 ${size}px ${fontFamily}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = toCssColor(state === 'normal' ? tone.keyLabel : tone.onAccent)
      ctx.fillText(`C${Math.floor(note / 12) - 1}`, midX(faces.topRect), maxY(faces.topRect) - 10)
    }
  })

  const blackW = whiteW * BLACK_WIDTH_RATIO
  const blackH = height * BLACK_HEIGHT_RATIO
  const blacks = geometry.blackKeys.map((key) => {
    const state = keyFaceState(key.note, pressed, guide, wrong)
    const faces = new KeycapFaces(
      { x: (key.whiteIndex + 1) * whiteW - blackW / 2, y: 0, w: blackW, h: blackH },
      {
        lipScale: bevel.blackLipScale * (state === 'pressed' ? bevel.pressedLipScale : 1),
        slopeGap: bevel.blackSlopeGap,
        squareTop: true,
      },
    )
    return { state, faces }
  })

  // 黒鍵が白鍵に落とす影（SwiftUI の shadow の radius 2.5 は canvas の shadowBlur ではその 2 倍）
  ctx.save()
  ctx.shadowColor = black(bevel.shadow * 1.6)
  ctx.shadowBlur = 5
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 2
  ctx.fillStyle = toCssColor(tone.graySide)
  for (const { faces } of blacks) ctx.fill(faces.side)
  ctx.restore()

  for (const { state, faces } of blacks) {
    const top = state === 'pressed' ? tone.pressedBlackTop : state === 'guide' ? tone.blackGuideTop : tone.grayTop
    faces.draw(
      ctx,
      {
        top,
        side: state === 'guide' ? tone.blackGuideSide : tone.graySide,
        sideTop: state === 'guide' ? tone.blackGuideSideTop : undefined,
      },
      { flat: true, slope: true },
    )
  }
}
