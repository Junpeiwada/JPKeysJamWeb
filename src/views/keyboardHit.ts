// 鍵盤の当たり判定（手本: JPKeyboardUI の KeyboardGeometry.hit）。描画から独立した純粋関数。
import { BLACK_HEIGHT_RATIO, BLACK_WIDTH_RATIO, type KeyboardGeometry } from '../guide/rollLayout'

/** 座標（鍵盤の左上が原点）→ 押される鍵。黒鍵を優先する。範囲外・サイズ 0 は null。
 * 鍵盤の外へはみ出した座標は端の鍵として扱う（指を滑らせて外へ出ても端の鍵にとどまる） */
export function hitNote(
  geometry: KeyboardGeometry,
  x: number,
  y: number,
  width: number,
  height: number,
): number | null {
  const whites = geometry.whiteNotes
  if (width <= 0 || height <= 0 || whites.length === 0) return null
  const whiteW = width / whites.length
  const blackW = whiteW * BLACK_WIDTH_RATIO
  const blackH = height * BLACK_HEIGHT_RATIO
  const clampedY = Math.min(Math.max(y, 0), height)
  if (clampedY < blackH) {
    for (const key of geometry.blackKeys) {
      const centerX = (key.whiteIndex + 1) * whiteW
      if (Math.abs(x - centerX) <= blackW / 2) return key.note
    }
  }
  const index = Math.min(Math.max(Math.floor(x / whiteW), 0), whites.length - 1)
  return whites[index]
}
