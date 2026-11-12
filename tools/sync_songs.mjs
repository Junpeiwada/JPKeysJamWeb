// 使い方: node tools/sync_songs.mjs
//
// JPKeysJam（iOS）の公開分の曲データ Resources/Songs を public/songs/ に同期して検査する。
//   - コピーするのは songs.json・*.mid・previews/*.mid だけ。SongsDev は絶対に読まない
//   - iOS 側の検査（JPKeysJam の docs/tools/check_release_songs.py）と同じ照合をする
//       songs.json の曲数が手直し表（docs/tools/catalog.csv）の rights=pd の件数と同じ、
//       全曲が手直し表にあり rights=pd・access=free、songs.json の access も free
//   - 全 arrangement の .mid と試聴がそろい、songs.json に無い .mid が無いこと
// OK なら「OK 133 曲」のように最後の行に出して終了コード 0、だめなら理由を並べて 1。Node の組み込みモジュールだけ。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = process.env.JPKEYSJAM_DIR
  ? path.resolve(process.env.JPKEYSJAM_DIR)
  : path.resolve(root, '..', 'JPKeysJam');
const src = path.join(srcRoot, 'Resources', 'Songs'); // 公開分だけ。SongsDev は読まない
// 出力先。テストでは JPKEYSJAM_WEB_SONGS_OUT で一時ディレクトリに差し替える
const dest = process.env.JPKEYSJAM_WEB_SONGS_OUT
  ? path.resolve(process.env.JPKEYSJAM_WEB_SONGS_OUT)
  : path.join(root, 'public', 'songs');
const catalogPath = path.join(srcRoot, 'docs', 'tools', 'catalog.csv');

function fail(errors) {
  for (const e of errors) console.log(`NG ${e}`);
  process.exit(1);
}

// 引用符付きの CSV（値にカンマ・改行・"" を含みうる）を行の配列にする
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

// 手直し表: 曲 ID（id が空なら fp.<directoryid>）→ { rights, access }
function readCatalog() {
  if (!fs.existsSync(catalogPath)) fail([`${catalogPath} がありません`]);
  const rows = parseCsv(fs.readFileSync(catalogPath, 'utf-8').replace(/^\uFEFF/, ''));
  const header = rows.shift() ?? [];
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const k of ['directoryid', 'id', 'access', 'rights']) {
    if (!(k in col)) fail([`${catalogPath} のヘッダーに ${k} がありません`]);
  }
  const map = new Map();
  const dup = [];
  for (const r of rows) {
    const id = (r[col.id] ?? '').trim() || `fp.${(r[col.directoryid] ?? '').trim()}`;
    if (map.has(id)) dup.push(`手直し表で曲 ID が重複: ${id}`);
    map.set(id, { rights: (r[col.rights] ?? '').trim(), access: (r[col.access] ?? '').trim() });
  }
  if (dup.length) fail(dup);
  return map;
}

// 元の検査（コピー前）
const jsonPath = path.join(src, 'songs.json');
if (!fs.existsSync(jsonPath)) fail([`${jsonPath} がありません`]);
let songs;
try {
  songs = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
} catch (e) {
  fail([`${jsonPath} を読めない: ${e.message}`]);
}
if (!Array.isArray(songs) || !songs.every((s) => s && typeof s === 'object' && !Array.isArray(s))) {
  fail(['songs.json が曲（オブジェクト）の配列ではない']);
}

const idPattern = /^[A-Za-z0-9._-]+$/;
const filePattern = /^[^/\\]+\.mid$/;
const errors = [];
const catalog = readCatalog();
const pdCount = [...catalog.values()].filter((c) => c.rights === 'pd').length;
if (songs.length !== pdCount) errors.push(`曲数が ${songs.length}（手直し表の pd は ${pdCount}）`);
const mids = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mid')) : []);
const expected = new Set(); // songs.json が指す .mid（Songs/ からの相対パス）
const seen = new Set();

for (const [i, s] of songs.entries()) {
  const id = s.id;
  if (typeof id !== 'string' || !id) {
    errors.push(`${i} 番目の曲の id が空でない文字列ではない`);
    continue;
  }
  if (!idPattern.test(id)) {
    errors.push(`${id}: 曲 ID の形が不正（英数字と . _ - だけ）`);
    continue;
  }
  if (seen.has(id)) errors.push(`曲 ID が重複: ${id}`);
  seen.add(id);
  const c = catalog.get(id);
  if (!c) errors.push(`${id}: 手直し表にない`);
  else {
    if (c.rights !== 'pd') errors.push(`${id}: 手直し表の rights が ${c.rights}（pd ではない）`);
    if (c.access !== 'free') errors.push(`${id}: 手直し表の access が ${c.access}（free ではない）`);
  }
  if (s.access !== 'free') errors.push(`${id}: songs.json の access が ${s.access}（free ではない）`);
  if (!Array.isArray(s.arrangements) || s.arrangements.length === 0) {
    errors.push(`${id}: arrangements が空か配列ではない`);
  } else {
    for (const a of s.arrangements) {
      const f = a && a.file;
      if (typeof f !== 'string' || !f) errors.push(`${id}: arrangement の file が空`);
      else if (!filePattern.test(f)) errors.push(`${id}: arrangement の file の形が不正: ${f}`);
      else expected.add(f);
    }
  }
  // 試聴は previews/<曲 id>.mid
  expected.add(`previews/${id}.mid`);
}

for (const f of expected) {
  if (!fs.existsSync(path.join(src, f))) errors.push(`${f} がありません`);
}
const actual = [...mids(src), ...mids(path.join(src, 'previews')).map((f) => `previews/${f}`)];
for (const f of actual) {
  if (!expected.has(f)) errors.push(`${f} は songs.json が指していない（余分）`);
}
if (errors.length) fail(errors);

// コピー（${dest}.tmp に書き、検査が通ってから dest と入れ替える。途中で失敗しても public/songs を欠けさせない）
const tmpDest = `${dest}.tmp`;
const oldDest = `${dest}.old`;
// 前回落ちて残った .tmp・.old があれば消す
fs.rmSync(tmpDest, { recursive: true, force: true });
fs.rmSync(oldDest, { recursive: true, force: true });
try {
  fs.mkdirSync(path.join(tmpDest, 'previews'), { recursive: true });
  fs.copyFileSync(jsonPath, path.join(tmpDest, 'songs.json'));
  for (const f of actual) fs.copyFileSync(path.join(src, f), path.join(tmpDest, f));
} catch (error) {
  fs.rmSync(tmpDest, { recursive: true, force: true });
  fail([`コピーに失敗した: ${error instanceof Error ? error.message : error}`]);
}

// コピー結果の検査
const copied = [...mids(tmpDest), ...mids(path.join(tmpDest, 'previews')).map((f) => `previews/${f}`)];
if (copied.length !== expected.size || !copied.every((f) => expected.has(f))) {
  fs.rmSync(tmpDest, { recursive: true, force: true });
  fail([`コピー結果が songs.json と合わない（${copied.length} 件、期待 ${expected.size} 件）`]);
}

// 外した曲が残らないよう入れ替える。dest を消さずに .old へ退避するので、途中で落ちても public/songs が無くならない
if (fs.existsSync(dest)) fs.renameSync(dest, oldDest);
fs.renameSync(tmpDest, dest);
fs.rmSync(oldDest, { recursive: true, force: true });

console.log(`OK ${songs.length} 曲`);
