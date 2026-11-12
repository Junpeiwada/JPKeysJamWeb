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
const LOGO_GLYPH = 'M 36.296875 7.558594 C 36.296875 6.863281 35.898438 5.902344 35.410156 5.40625 L 31.261719 1.265625 C 30.773438 0.777344 29.8125 0.378906 29.117188 0.378906 L 22.753906 0.378906 C 22.058594 0.378906 21.097656 0.777344 20.609375 1.265625 L 9.054688 12.8125 C 8.570312 13.304688 7.769531 13.304688 7.28125 12.8125 L 6.390625 11.921875 C 5.90625 11.433594 5.90625 10.636719 6.398438 10.148438 L 13.164062 3.375 C 13.652344 2.886719 13.488281 2.484375 12.796875 2.484375 L 7.609375 2.484375 C 6.914062 2.484375 5.953125 2.886719 5.464844 3.375 L 1.0625 7.777344 C 0.574219 8.265625 0.175781 9.234375 0.175781 9.921875 L 0.175781 13.335938 C 0.175781 14.019531 0.574219 14.988281 1.0625 15.476562 L 4.320312 18.734375 C 4.808594 19.222656 5.773438 19.621094 6.460938 19.621094 L 9.875 19.621094 C 10.566406 19.621094 11.53125 19.222656 12.015625 18.734375 L 16.160156 14.589844 C 16.65625 14.105469 17.453125 14.105469 17.941406 14.589844 L 22.085938 18.734375 C 22.578125 19.222656 23.539062 19.621094 24.226562 19.621094 L 27.644531 19.621094 C 28.328125 19.621094 29.296875 19.222656 29.78125 18.734375 L 35.410156 13.109375 C 35.898438 12.621094 36.296875 11.652344 36.296875 10.964844 Z M 26.824219 12.8125 C 26.339844 13.304688 25.539062 13.304688 25.046875 12.8125 L 22.382812 10.148438 C 21.890625 9.660156 21.890625 8.863281 22.382812 8.375 L 25.046875 5.707031 C 25.539062 5.21875 26.339844 5.21875 26.824219 5.707031 L 29.488281 8.375 C 29.976562 8.863281 29.976562 9.660156 29.488281 10.148438 Z M 26.824219 12.8125 '

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
