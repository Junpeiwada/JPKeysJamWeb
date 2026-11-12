// 使い方: node tools/make_soundfont.mjs
//
// JPKeysJam（iOS）の GeneralUser-GS.sf2 から bank 0・program 0（ピアノ）だけを残した音源を
// public/soundfont/ に書き出す。
//   - SF3（Vorbis 圧縮）には Vorbis のエンコーダーが要る。spessasynth_core が持つのはデコーダー（stb-vorbis）だけなので、
//     ピアノだけの SF2（piano.sf2）で出す。10MB を超えたら出さずに失敗する
//   - ライセンス文 GeneralUser-GS.txt を public/licenses/ にコピーする
//   - 最後に書き出した音源を読み直し、プリセットが bank 0・program 0 の 1 つだけであることを確かめる
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = process.env.JPKEYSJAM_DIR
  ? path.resolve(process.env.JPKEYSJAM_DIR)
  : path.resolve(root, '..', 'JPKeysJam');
const srcSf2 = path.join(srcRoot, 'Resources', 'SoundFonts', 'GeneralUser-GS.sf2');
const srcLicense = path.join(srcRoot, 'Resources', 'Licenses', 'GeneralUser-GS.txt');
const destDir = path.join(root, 'public', 'soundfont');
const destSf2 = path.join(destDir, 'piano.sf2');
const destLicense = path.join(root, 'public', 'licenses', 'GeneralUser-GS.txt');
const maxBytes = 10 * 1024 * 1024;

function fail(msg) {
  console.log(`NG ${msg}`);
  process.exit(1);
}

for (const p of [srcSf2, srcLicense]) {
  if (!fs.existsSync(p)) fail(`${p} がありません`);
}

await BasicSoundBank.ready; // SF3 の元でも読めるよう、デコーダーの準備を待つ

const buf = fs.readFileSync(srcSf2);
const bank = SoundBankLoader.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// bank 0・program 0（ドラムでない）以外のプリセットを消し、使われなくなった instrument・sample を落とす
const keep = bank.presets.find((p) => p.bankMSB === 0 && p.bankLSB === 0 && p.program === 0 && !p.isGMGSDrum);
if (!keep) fail('元の音源に bank 0・program 0 のプリセットがありません');
for (const p of [...bank.presets]) {
  if (p !== keep) bank.deletePreset(p);
}
bank.removeUnusedElements();
bank.flush();

const out = Buffer.from(bank.writeSF2());
if (out.length > maxBytes) fail(`piano.sf2 が ${out.length} バイトで 10MB を超える（sample rate を下げる等はせず、報告して止まる）`);

// piano.sf2.tmp に書き、読み直して検査が通ってから piano.sf2 に置く（検査に落ちても不正な piano.sf2 を残さない）
const tmpSf2 = `${destSf2}.tmp`;
fs.mkdirSync(destDir, { recursive: true });
fs.writeFileSync(tmpSf2, out);
let check;
try {
  const rb = fs.readFileSync(tmpSf2);
  check = SoundBankLoader.fromArrayBuffer(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength));
} catch (error) {
  fs.rmSync(tmpSf2, { force: true });
  fail(`書き出した音源を読み直せない: ${error instanceof Error ? error.message : error}`);
}
const ok =
  check.presets.length === 1 &&
  check.presets[0].bankMSB === 0 &&
  check.presets[0].bankLSB === 0 &&
  check.presets[0].program === 0;
if (!ok) {
  fs.rmSync(tmpSf2, { force: true });
  fail(`読み直したプリセットが想定と違う: ${check.presets.map((p) => `${p.bankMSB}:${p.bankLSB}:${p.program} ${p.name}`).join(', ')}`);
}
fs.renameSync(tmpSf2, destSf2);
// 古い出力（piano.sf2 以外）は最後に消す
for (const f of fs.readdirSync(destDir)) {
  if (f !== 'piano.sf2') fs.rmSync(path.join(destDir, f), { recursive: true, force: true });
}
fs.mkdirSync(path.dirname(destLicense), { recursive: true });
fs.copyFileSync(srcLicense, destLicense);
console.log(
  `OK piano.sf2 ${out.length} バイト（${(out.length / 1024 / 1024).toFixed(2)}MB）プリセット 1 つ: ` +
    `${check.presets[0].name} / instrument ${check.instruments.length} / sample ${check.samples.length}`,
);
