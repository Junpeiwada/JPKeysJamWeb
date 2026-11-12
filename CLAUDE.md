# CLAUDE.md

## このリポジトリ

iOS アプリ JPKeysJam（`../JPKeysJam`、private）の「弾くまで待つ」ガイドを、Android Chrome 向けの Web にしたもの。GitHub Pages で公開する（base は `/JPKeysJamWeb/`）。

## 先に読むもの

- `docs/実装計画-JPKeysJamWeb.md` — 進捗台帳
- 判定の決まりは `../JPKeysJam/docs/概要.md` の「決めたこと」

## ビルドとテスト

```bash
npm ci
npm run dev        # 開発サーバ
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # dist/ に書き出す
```

## 約束

- 曲は `npm run sync:songs` で `../JPKeysJam/Resources/Songs`（pd の公開分）からだけコピーする。`Resources/SongsDev`（全曲・著作権のある曲を含む）は絶対に入れない。曲を増減したら sync して `public/songs` をコミットする
- 音源は `npm run make:soundfont` で GeneralUser-GS.sf2 からピアノだけを書き出す
- 色の値は `src/theme.ts` と `src/styles.css` にしか書かない（JPKeyboardUI の Theme.swift と同じ値）
- ch は 0 始まり（0 = ch1 = 右手、1 = ch2 = 左手）
- テストは Vitest。`src/**/*.test.ts(x)` に置き、`vitest` から明示的に import する（globals は使わない）
- npm の依存は公開から 2 週間以上たった版を完全な版で固定する（`^` を付けない）
- 文章・コメントは日本語

## やらないこと

音色の選択、13 鍵×2 台、Firebase、Web Bluetooth、著作権のある曲
