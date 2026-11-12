// 演奏画面のアイコン。iOS の SF Symbols（chevron.down・backward.end.fill・play.fill・pause.fill・gearshape）に似せた SVG。
// 色は currentColor（呼び出し側の CSS の色）で塗る。
import type { ReactElement } from 'react'

interface IconProps {
  size: number
}

/** chevron.down */
export function ChevronDown({ size }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 3.2 L5 6.8 L8.5 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** backward.end.fill（最初から） */
export function BackwardEndFill({ size }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="2.6" height="11" rx="0.8" fill="currentColor" />
      <path d="M14 3.4 C14 2.6 13.2 2.2 12.5 2.6 L5.8 7.1 C5.2 7.5 5.2 8.5 5.8 8.9 L12.5 13.4 C13.2 13.8 14 13.4 14 12.6 Z" fill="currentColor" />
    </svg>
  )
}

/** play.fill（自動演奏） */
export function PlayFill({ size }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 2.6 C3.5 1.8 4.3 1.4 5 1.8 L13.6 7.1 C14.2 7.5 14.2 8.5 13.6 8.9 L5 14.2 C4.3 14.6 3.5 14.2 3.5 13.4 Z" fill="currentColor" />
    </svg>
  )
}

/** pause.fill（自動演奏をやめる） */
export function PauseFill({ size }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2" width="3.6" height="12" rx="1" fill="currentColor" />
      <rect x="9.4" y="2" width="3.6" height="12" rx="1" fill="currentColor" />
    </svg>
  )
}

/** gearshape の歯の外形（歯 8 つ）。中心 (12, 12) */
function gearPath(): string {
  const teeth = 8
  const outer = 10.2
  const inner = 8.0
  const points: string[] = []
  for (let i = 0; i < teeth; i++) {
    const base = (i / teeth) * Math.PI * 2
    const step = (Math.PI * 2) / teeth
    // 歯の付け根 → 歯先 → 歯先 → 付け根
    const angles: [number, number][] = [
      [base - step * 0.5 + step * 0.12, inner],
      [base - step * 0.22, outer],
      [base + step * 0.22, outer],
      [base + step * 0.5 - step * 0.12, inner],
    ]
    for (const [a, r] of angles) points.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M ${points.join(' L ')} Z`
}
const GEAR = gearPath()

/** gearshape（設定） */
export function Gearshape({ size }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={GEAR} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** JP のグリフ（iOS の TopBarLogo.pdf を SVG にしたもの） */
const LOGO_GLYPH = 'M 36.296875 7.554688 C 36.296875 6.863281 35.898438 5.898438 35.410156 5.410156 L 31.265625 1.265625 C 30.777344 0.777344 29.8125 0.378906 29.121094 0.378906 L 22.753906 0.378906 C 22.0625 0.378906 21.097656 0.777344 20.609375 1.265625 L 9.054688 12.816406 C 8.566406 13.304688 7.769531 13.304688 7.277344 12.816406 L 6.390625 11.925781 C 5.902344 11.4375 5.902344 10.640625 6.390625 10.148438 L 13.496094 3.039062 C 13.984375 2.550781 13.820312 2.195312 13.132812 2.242188 L 7.34375 2.652344 C 6.65625 2.703125 5.691406 3.140625 5.203125 3.632812 L 1.0625 7.777344 C 0.574219 8.265625 0.175781 9.230469 0.175781 9.921875 L 0.175781 13.332031 C 0.175781 14.019531 0.574219 14.988281 1.0625 15.472656 L 4.320312 18.734375 C 4.808594 19.222656 5.773438 19.621094 6.460938 19.621094 L 9.871094 19.621094 C 10.5625 19.621094 11.527344 19.222656 12.015625 18.734375 L 16.160156 14.589844 C 16.648438 14.101562 17.445312 14.101562 17.9375 14.589844 L 22.082031 18.734375 C 22.570312 19.222656 23.535156 19.621094 24.226562 19.621094 L 27.636719 19.621094 C 28.324219 19.621094 29.292969 19.222656 29.78125 18.734375 L 35.40625 13.109375 C 35.894531 12.621094 36.292969 11.652344 36.292969 10.964844 L 36.292969 7.554688 Z M 26.824219 12.816406 C 26.335938 13.304688 25.535156 13.304688 25.046875 12.816406 L 22.378906 10.152344 C 21.890625 9.664062 21.890625 8.863281 22.378906 8.375 L 25.042969 5.710938 C 25.53125 5.222656 26.332031 5.222656 26.820312 5.710938 L 29.484375 8.378906 C 29.972656 8.867188 29.972656 9.664062 29.484375 10.15625 L 26.820312 12.816406 Z M 26.824219 12.816406 '

/** ロゴ（グリフと「KeysJam」）。手本: BrandLogo.swift */
export function BrandLogo({ glyphHeight }: { glyphHeight: number }): ReactElement {
  return (
    <span className="brand-logo" style={{ gap: glyphHeight * 0.5 }} aria-hidden="true">
      <svg height={glyphHeight} viewBox="0 0 37.22825 20" style={{ width: (glyphHeight * 37.22825) / 20 }}>
        <path d={LOGO_GLYPH} fill="currentColor" fillRule="evenodd" />
      </svg>
      <span style={{ fontSize: glyphHeight * 0.95, fontWeight: 700, lineHeight: 1 }}>KeysJam</span>
    </span>
  )
}
