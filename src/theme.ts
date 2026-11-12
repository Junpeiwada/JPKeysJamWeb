// 色はこのファイルと styles.css だけで決める（手本: JPKeyboardUI の Theme.swift の Palette・Tone）。
// styles.css の :root は CSS から TS を読めないため値を書き写してあり、theme.test.ts でずれを検出する。

/** 基本の 5 色（0xRRGGBB） */
export const palette = {
  /** ごく明るいグレー（白鍵・文字） */
  paper: 0xf3f5f5,
  /** チャコール（筐体・ボタンの面） */
  charcoal: 0x2e3236,
  /** 黒に近いグレー（黒鍵） */
  gray: 0x1f2225,
  /** ライム（光る鍵・選択中） */
  lime: 0xc8dd3c,
  /** 影・ライムの上の文字の元になるほぼ黒 */
  ink: 0x111315,
} as const

/** 0xRRGGBB どうしをチャンネルごとに線形に混ぜる。a に b を t の割合で混ぜ、四捨五入して 0〜255 に収める（Swift の mix と同じ） */
export function mix(a: number, b: number, t: number): number {
  const blend = (shift: number): number => {
    const ca = (a >> shift) & 0xff
    const cb = (b >> shift) & 0xff
    const v = Math.min(Math.max(Math.round(ca * (1 - t) + cb * t), 0), 255)
    return v << shift
  }
  return blend(16) | blend(8) | blend(0)
}

const blackGuideTop = 0x1f8fd6
const ble = 0x3fa9e0

/** 役割ごとの色。Palette の 2 色を混ぜて作る */
export const tone = {
  bg: mix(palette.charcoal, palette.ink, 0.45),
  panel: mix(palette.charcoal, palette.ink, 0.2),
  panel2: mix(palette.charcoal, palette.paper, 0.06),
  line: mix(palette.charcoal, palette.paper, 0.14),
  text: palette.paper,
  sub: mix(palette.paper, palette.charcoal, 0.45),
  accent: palette.lime,
  accentDeep: mix(palette.lime, palette.ink, 0.35),
  /** 暗い地の上に置くライム系の文字・アイコン */
  accentInk: palette.lime,
  onAccent: palette.ink,
  /** 画面に重ねるカードの後ろに敷く幕（不透明度は使う側で掛ける） */
  scrim: palette.ink,
  /** ボタン・チップの側面 */
  capSide: mix(palette.charcoal, palette.ink, 0.55),
  whiteTop: palette.paper,
  whiteSide: mix(palette.paper, palette.ink, 0.3),
  grayTop: palette.gray,
  graySide: mix(palette.gray, palette.ink, 0.6),
  /** 鍵が収まる溝 */
  well: mix(palette.charcoal, palette.ink, 0.7),
  keyLabel: mix(palette.paper, palette.ink, 0.42),
  /** 押している白鍵の面 */
  pressedTop: mix(palette.paper, palette.charcoal, 0.35),
  /** 押している黒鍵の面 */
  pressedBlackTop: mix(palette.gray, palette.paper, 0.05),
  /** 接続方式のバッジ（USB は緑、BLE は青） */
  usb: 0x4cc46a,
  ble,
  /** 黒鍵の色（青）。白鍵はライム */
  blackAccent: ble,
  /** 次に押す黒鍵の面 */
  blackGuideTop,
  /** 次に押す黒鍵の側面の上端 */
  blackGuideSideTop: mix(blackGuideTop, palette.ink, 0.3),
  /** 次に押す黒鍵の側面の下端 */
  blackGuideSide: mix(ble, palette.ink, 0.75),
} as const

/** 0xRRGGBB を `#rrggbb` にする */
export function toCssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

/** camelCase を kebab-case にする（accentDeep → accent-deep） */
function kebab(name: string): string {
  return name.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)
}

/** CSS 変数名（`--accent-deep` など）→ `#rrggbb`。Tone の全項目 */
export const cssVariables: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(tone).map(([name, value]) => [`--${kebab(name)}`, toCssColor(value)]),
)

/**
 * ベベルとフィレット（形の値）。JPKeyboardUI の Theme.swift の Bevel と同じ値。
 * 部品の大きさに対する割合で決め、上限・下限で止める（どの大きさでも同じ見え方にする）
 */
export const bevel = {
  /** 角丸の半径（短辺に対する割合） */
  filletRatio: 0.12,
  filletMin: 2,
  filletMax: 8,
  /** 手前の縁の厚み（高さに対する割合） */
  lipRatio: 0.05,
  lipMin: 2,
  lipMax: 7,
  /** 左右と奥の縁の厚み（手前の縁に対する割合） */
  rimRatio: 0.35,
  /** 上面の照り返しの濃さ（白の不透明度） */
  highlight: 0.2,
  /** 上面の奥側を明るくする量（白を混ぜる割合） */
  sheen: 0.12,
  /** 白鍵の上面と手前の縁の境目の線（黒の不透明度） */
  crease: 0.2,
  /** 境目の線の下端の太さ */
  creaseWidth: 4,
  /** 境目の線のすぐ上のハイライト（白の不透明度と太さ） */
  shine: 1.0,
  shineWidth: 2,
  /** 黒鍵の手前の縁を白鍵の何倍にするか */
  blackLipScale: 1.7,
  /** 黒鍵の手前の斜面の明るい側の明るさ（上面の色に白を混ぜる割合） */
  blackSlopeLight: 0.35,
  /** 黒鍵の斜面の下に残す本体の縁の厚み */
  blackSlopeGap: 3,
  /** 押している鍵の手前の縁の厚み（ふつうの何倍にするか） */
  pressedLipScale: 0.4,
  /** 押している白鍵の奥の端に落とす影（黒の不透明度と、鍵の高さに対する長さ） */
  pressedShade: 0.18,
  pressedShadeRatio: 0.31,
  /** 押している白鍵の左の端に落とす、左隣の鍵の影（黒の不透明度と幅） */
  pressedSideShade: 0.2,
  pressedSideShadeWidth: 16,
  pressedSideShadeNear: 0.4,
  pressedSideShadeFar: 0.12,
  /** 落ち影の濃さ（黒の不透明度） */
  shadow: 0.16,
} as const

/** 角丸の半径 */
export function fillet(width: number, height: number): number {
  return Math.min(Math.max(Math.min(width, height) * bevel.filletRatio, bevel.filletMin), bevel.filletMax)
}

/** 手前の縁の厚み */
export function lip(height: number): number {
  return Math.min(Math.max(height * bevel.lipRatio, bevel.lipMin), bevel.lipMax)
}

/** 左右と奥の縁の厚み */
export function rim(height: number): number {
  return Math.max(0.75, lip(height) * bevel.rimRatio)
}
