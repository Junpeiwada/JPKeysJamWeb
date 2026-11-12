# JPKeysJamWeb

iPhone・iPad 向けアプリ [JPKeysJam](https://apps.apple.com/jp/app/jpkeysjam/id6829560423) の Web 版です。正しい鍵を押すと曲が進み、伴奏もそこまで鳴る「弾くまで待つ」ガイドで、MIDI 鍵盤（JP-MIDIKey13／25 など）で曲を弾けます。入っているのは著作権の切れた曲だけです。

公開 URL: https://junpeiwada.github.io/JPKeysJamWeb/

## 使い方

1. Android の Chrome でこのページを開きます。メニューの「ホーム画面に追加」でアプリのように使えます。
2. MIDI 鍵盤は USB（OTG）でつなぎます。つないでいなくても、画面の鍵盤で弾けます。
3. 最初に画面をタップすると音が出るようになります（ブラウザの決まりです）。

## 対応ブラウザ

- Android・PC の Chrome、Edge: MIDI 鍵盤が使えます
- Firefox、Safari: 動作を確かめていないため、画面の鍵盤だけを想定しています

## 開発

```bash
npm ci
npm run dev     # 開発サーバー
npm test        # テスト
npm run build   # 型チェックと本番ビルド（dist/）
```

- 曲の同期（`npm run sync:songs`）には、隣のフォルダ `../JPKeysJam`（iOS 版）が要ります。同期した `public/songs` と `public/soundfont` はコミットしてあるので、通常の開発・CI には不要です。
- main への push で、GitHub Actions（`.github/workflows/pages.yml`）がテストとビルドを流し、GitHub Pages に公開します。

## ライセンス

- 音源: GeneralUser GS v2.0.3 — S. Christian Collins（`public/licenses/GeneralUser-GS.txt`）
- シンセサイザー: spessasynth_lib・spessasynth_core — Apache License 2.0
- 曲: 作曲者の著作権が切れたものだけです。
