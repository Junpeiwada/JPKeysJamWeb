import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PreviewPlayer } from '../audio/preview'
import { genreTitle, type SongCatalog, type SongEntry, type SongGenre } from '../library/catalog'
import { searchSongs } from '../library/search'
import type { PlayHistory } from '../library/history'
import { HistoryList } from './HistoryList'
import { levelName } from './SongDetail'
import './Home.css'

export interface HomeProps {
  catalog: SongCatalog
  preview: PreviewPlayer
  onSelect(songID: string): void
  /** 上に差し込むもの（履歴・設定ボタンなど。後の波で使う） */
  header?: ReactNode
  /** 弾いた曲の履歴。無ければ履歴の UI（棚・履歴の切り替え）を出さない */
  history?: PlayHistory
}

type Tab = 'featured' | 'history' | 'genre'

/** おすすめの先頭の棚に出す最大曲数 */
const SHELF_LIMIT = 10

/** ホーム。検索欄と、おすすめ・ジャンルの切り替え */
export function Home({ catalog, preview, onSelect, header, history }: HomeProps) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('featured')
  const [genre, setGenre] = useState<SongGenre | undefined>(undefined)
  // 履歴は PlayHistory が購読を持たないので、消したあとにこの値で再描画する
  const [, setHistoryRev] = useState(0)
  const playingID = useSyncExternalStore(
    useCallback((cb: () => void) => preview.subscribe(cb), [preview]),
    () => preview.playingID,
  )

  const searching = query.trim() !== ''
  const results = useMemo(() => searchSongs(query, catalog.entries, 'ja'), [query, catalog])
  const shelf = history
    ? history
        .recentSongs(SHELF_LIMIT, (id) => catalog.song(id) !== undefined)
        .flatMap((r) => catalog.song(r.songID) ?? [])
    : []
  const showHistory = history !== undefined && tab === 'history'
  const activeGenre = genre && catalog.genres.includes(genre) ? genre : catalog.genres[0]

  let list: SongEntry[]
  if (searching) list = results
  else if (tab === 'featured') list = catalog.featured
  else if (tab === 'history') list = []
  else list = activeGenre ? catalog.songs(activeGenre) : []

  const togglePreview = (id: string) => {
    if (playingID === id) preview.stop()
    else void preview.play(id)
  }

  return (
    <div className="home">
      {header}
      <input
        type="search"
        className="home__search"
        placeholder="曲名・作曲者で探す"
        aria-label="曲を検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!searching && (
        <>
          <div className="home__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'featured'}
              className={`home__tab${tab === 'featured' ? ' is-selected' : ''}`}
              onClick={() => setTab('featured')}
            >
              おすすめ
            </button>
            {history && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'history'}
                className={`home__tab${tab === 'history' ? ' is-selected' : ''}`}
                onClick={() => setTab('history')}
              >
                履歴
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'genre'}
              className={`home__tab${tab === 'genre' ? ' is-selected' : ''}`}
              onClick={() => setTab('genre')}
            >
              ジャンル
            </button>
          </div>
          {tab === 'genre' && (
            <div className="home__chips">
              {catalog.genres.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`home__chip${g === activeGenre ? ' is-selected' : ''}`}
                  onClick={() => setGenre(g)}
                >
                  {genreTitle(g)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {!searching && history && tab === 'featured' && shelf.length > 0 && (
        <>
          <div className="home__shelf-head">
            <h2 className="home__shelf-title">最近弾いた曲</h2>
            <button type="button" className="home__shelf-all" onClick={() => setTab('history')}>
              すべて ›
            </button>
          </div>
          <ul className="home__shelf">
            {shelf.map((song) => (
              <li key={song.id}>
                <button type="button" className="home__shelf-card" onClick={() => onSelect(song.id)}>
                  {song.title.ja}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!searching && history && showHistory && (
        <HistoryList
          catalog={catalog}
          history={history}
          onSelect={onSelect}
          onChange={() => setHistoryRev((n) => n + 1)}
        />
      )}
      {searching && list.length === 0 && <p className="home__empty">見つかりませんでした</p>}
      <ul className="home__list">
        {list.map((song) => (
          <li key={song.id} className="home__row">
            <button type="button" className="home__song" onClick={() => onSelect(song.id)}>
              <span className="home__song-title">{song.title.ja}</span>
              <span className="home__song-sub">
                {song.composer.ja}
                {song.composer.ja !== '' && '・'}
                {levelName(song.difficulty)}
              </span>
            </button>
            <button
              type="button"
              className="home__preview"
              aria-label={playingID === song.id ? `${song.title.ja}の試聴を止める` : `${song.title.ja}を試聴`}
              onClick={() => togglePreview(song.id)}
            >
              {playingID === song.id ? '■' : '▶'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
