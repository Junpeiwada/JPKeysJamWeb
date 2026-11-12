import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { cssVariables, mix, palette, tone } from './theme'

describe('mix', () => {
  it('t=0 は a、t=1 は b になる', () => {
    expect(mix(0x102030, 0xf0e0d0, 0)).toBe(0x102030)
    expect(mix(0x102030, 0xf0e0d0, 1)).toBe(0xf0e0d0)
  })

  it('チャンネルごとに線形に混ぜて四捨五入する', () => {
    // 0 と 255 の中間 127.5 は 128 に丸まる
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080)
  })
})

describe('tone', () => {
  it('Swift の Tone と同じ値になる', () => {
    expect(tone.bg).toBe(0x212427)
    expect(tone.panel).toBe(0x282c2f)
    expect(tone.sub).toBe(0x9a9d9f)
    expect(tone.accentDeep).toBe(0x88962e)
    expect(tone.blackGuideSide).toBe(0x1d3948)
    expect(tone.text).toBe(palette.paper)
    expect(tone.accent).toBe(palette.lime)
  })
})

describe('cssVariables', () => {
  it('kebab-case の変数名で #rrggbb を持つ', () => {
    expect(cssVariables['--bg']).toBe('#212427')
    expect(cssVariables['--accent-deep']).toBe('#88962e')
    expect(cssVariables['--black-guide-side-top']).toBe('#1b6a9c')
    expect(Object.keys(cssVariables)).toHaveLength(Object.keys(tone).length)
  })

  it('styles.css の :root の値と一致する', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const found: Record<string, string> = {}
    for (const m of root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      found[m[1]] = m[2].trim().toLowerCase()
    }
    expect(found).toEqual(cssVariables)
  })
})
