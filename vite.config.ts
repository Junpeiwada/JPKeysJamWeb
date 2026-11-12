import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { cssVariables } from './src/theme.ts'

// 色の値は src/theme.ts だけに書く決まりなので、背景色はそこから取る
const themeColor = cssVariables['--bg']

// index.html の %THEME_COLOR% を theme.ts の背景色に置き換える
function themeColorHtml(): Plugin {
  return {
    name: 'theme-color-html',
    transformIndexHtml: (html) => html.replaceAll('%THEME_COLOR%', themeColor),
  }
}

// GitHub Pages の https://junpeiwada.github.io/JPKeysJamWeb/ に置くため base を固定する
export default defineConfig({
  base: '/JPKeysJamWeb/',
  plugins: [
    react(),
    themeColorHtml(),
    VitePWA({
      // 新しい service worker は開いている間は入れ替えず（waiting のまま）、
      // 全タブを閉じて次に開いたときに有効になる。確認画面は出さない
      registerType: 'prompt',
      // 開発中（npm run dev）は service worker を登録しない（devOptions は既定で無効）
      manifest: {
        name: 'JPKeysJam',
        short_name: 'JPKeysJam',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/JPKeysJamWeb/',
        scope: '/JPKeysJamWeb/',
        lang: 'ja',
        theme_color: themeColor,
        background_color: themeColor,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // 背景の絵が端まであり、JP マークは中央の約 53% に収まるので、Android の丸い切り抜き（中央 80%）でも欠けない
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 開いている間に古い precache が消えると、タップで初めて取得する AudioWorklet が失敗するため即時入れ替えはしない
        skipWaiting: false,
        clientsClaim: false,
        // アプリ一式と曲・音源・アイコン・ライセンスを先読みでキャッシュする
        globPatterns: [
          '**/*.{js,css,html,webmanifest}',
          'songs/**/*',
          'soundfont/**/*',
          'icons/**/*',
          'licenses/**/*',
        ],
        // 既定の 2MB だと音源が落ちるので上げる
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
  },
})
