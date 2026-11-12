import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = path.resolve(__dirname, 'sync_songs.mjs')

let tmp: string
let srcDir: string
let outDir: string

// JPKeysJam の形を小さく組む（曲 a・b の 2 曲）
function build(
  opts: {
    access?: string
    rights?: string
    extraMid?: boolean
    noPreview?: boolean
    extraPd?: boolean
    missingFromCatalog?: boolean
    catalogAccess?: string
    noCatalog?: boolean
    dupCatalog?: boolean
    badFile?: string
  } = {},
) {
  const songs = path.join(srcDir, 'Resources', 'Songs')
  fs.mkdirSync(path.join(songs, 'previews'), { recursive: true })
  fs.mkdirSync(path.join(srcDir, 'docs', 'tools'), { recursive: true })
  const list = ['t.a', 'fp.2'].map((id, i) => ({
    id,
    access: i === 0 ? (opts.access ?? 'free') : 'free',
    arrangements: [{ file: id === 't.a' && opts.badFile ? opts.badFile : `${id}.mid` }],
  }))
  fs.writeFileSync(path.join(songs, 'songs.json'), JSON.stringify(list))
  for (const s of list) {
    fs.writeFileSync(path.join(songs, `${s.id}.mid`), 'x')
    if (!(opts.noPreview && s.id === 't.a')) fs.writeFileSync(path.join(songs, 'previews', `${s.id}.mid`), 'x')
  }
  if (opts.extraMid) fs.writeFileSync(path.join(songs, 'extra.mid'), 'x')
  // 値にカンマを含む行（引用符付き）も混ぜる。曲 2 は id が空の行なので fp.2 に補完される
  const csv = [
    'directoryid,id,title_ja,access,rights',
    `1,t.a,"曲, A",free,${opts.rights ?? 'pd'}`,
    `2,,曲B,${opts.catalogAccess ?? 'free'},pd`,
    '3,,他社の曲,paid,jasrac',
  ]
  if (opts.extraPd) csv.push('4,,余分な曲,free,pd')
  if (opts.dupCatalog) csv.push('1,t.a,重複,free,pd')
  if (opts.missingFromCatalog) csv.splice(2, 1)
  if (!opts.noCatalog) fs.writeFileSync(path.join(srcDir, 'docs', 'tools', 'catalog.csv'), csv.join('\n') + '\n')
}

function run() {
  return spawnSync('node', [script], {
    env: { ...process.env, JPKEYSJAM_DIR: srcDir, JPKEYSJAM_WEB_SONGS_OUT: outDir },
    encoding: 'utf-8',
  })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync_songs-'))
  srcDir = path.join(tmp, 'JPKeysJam')
  outDir = path.join(tmp, 'out')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('sync_songs.mjs', () => {
  it('正常なら 0 で、出力先にコピーする', () => {
    build()
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('OK 2 曲')
    expect(fs.existsSync(path.join(outDir, 'songs.json'))).toBe(true)
  })

  it('access が free でない曲があると 1', () => {
    build({ access: 'paid' })
    expect(run().status).toBe(1)
  })

  it('手直し表の rights が pd でない曲があると 1', () => {
    build({ rights: 'jasrac' })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('rights')
  })

  it('余分な .mid があると 1', () => {
    build({ extraMid: true })
    expect(run().status).toBe(1)
  })

  it('試聴が欠けていると 1', () => {
    build({ noPreview: true })
    expect(run().status).toBe(1)
  })

  it('手直し表の pd が 1 つ多いと 1（曲数がずれる）', () => {
    build({ extraPd: true })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('曲数')
  })

  it('songs.json の曲が手直し表にないと 1', () => {
    build({ missingFromCatalog: true })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('手直し表にない')
  })

  it('手直し表の access が free でないと 1', () => {
    build({ catalogAccess: 'paid' })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('access')
  })

  it('catalog.csv がないと 1', () => {
    build({ noCatalog: true })
    expect(run().status).toBe(1)
  })

  it('失敗したとき出力先は作られない', () => {
    build({ rights: 'jasrac' })
    expect(run().status).toBe(1)
    expect(fs.existsSync(outDir)).toBe(false)
  })

  it('失敗したとき既存の出力先の中身は変わらない', () => {
    build({ rights: 'jasrac' })
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'old.mid'), 'old')
    expect(run().status).toBe(1)
    expect(fs.readFileSync(path.join(outDir, 'old.mid'), 'utf-8')).toBe('old')
  })

  it('arrangement の file が ../ を含むと 1', () => {
    build({ badFile: '../SongsDev/x.mid' })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('file の形が不正')
  })

  it('手直し表で同じ ID の行が重複すると 1', () => {
    build({ dupCatalog: true })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('重複')
  })
})
