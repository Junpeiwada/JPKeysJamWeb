import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { PreviewPlayer } from '../audio/preview'
import type { ArrangementHands, SongArrangement, SongEntry } from '../library/catalog'
import type { AppSettings } from '../library/settings'
import './SongDetail.css'

export interface SongDetailProps {
  song: SongEntry
  settings: AppSettings
  preview: PreviewPlayer
  onClose(): void
  onPlay(songID: string, arrangementID: string): void
}

/** 難しさの名前（1 以下・2・3 以上） */
export function levelName(level: number): string {
  if (level <= 1) return 'やさしい'
  if (level === 2) return 'ふつう'
  return 'むずかしい'
}

/** 弾く手の名前 */
export function handsName(hands: ArrangementHands): string {
  return hands === 'right' ? '右手' : '両手'
}

/** 譜面の見出し（難しさ＋手）。同じ見出しが 2 つ以上あるときは番号を足す */
export function arrangementHeadings(arrangements: readonly SongArrangement[]): { title: string; hands: string }[] {
  const bases = arrangements.map((a) => ({ title: levelName(a.level), hands: handsName(a.hands) }))
  const total = new Map<string, number>()
  for (const b of bases) {
    const key = `${b.title}/${b.hands}`
    total.set(key, (total.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return bases.map((b) => {
    const key = `${b.title}/${b.hands}`
    if ((total.get(key) ?? 0) <= 1) return b
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return { title: `${b.title} ${n}`, hands: b.hands }
  })
}

/** 曲の詳細のカード。ホームの上に重ねて出す。選んだ譜面は曲ごとに覚える */
export function SongDetail({ song, settings, preview, onClose, onPlay }: SongDetailProps) {
  // 覚えた譜面（もう無ければ先頭）
  const [selectedID, setSelectedID] = useState<string | undefined>(() => settings.arrangementFor(song.id))
  const selected = song.arrangements.find((a) => a.id === selectedID) ?? song.arrangements[0]!
  const headings = arrangementHeadings(song.arrangements)

  const playingID = useSyncExternalStore(
    useCallback((cb: () => void) => preview.subscribe(cb), [preview]),
    () => preview.playingID,
  )
  const isPreviewing = playingID === song.id

  // 詳細を閉じたら試聴を止める
  useEffect(() => () => preview.stop(), [preview])

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const choose = (arrangement: SongArrangement) => {
    setSelectedID(arrangement.id)
    settings.setArrangement(song.id, arrangement.id)
  }

  const togglePreview = () => {
    if (isPreviewing) preview.stop()
    else void preview.play(song.id)
  }

  const play = () => {
    preview.stop()
    onPlay(song.id, selected.id)
  }

  return (
    <div className="song-detail__scrim" onClick={onClose}>
      <div
        className="song-detail"
        role="dialog"
        aria-modal="true"
        aria-label={song.title.ja}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="song-detail__close" aria-label="閉じる" autoFocus onClick={onClose}>
          ×
        </button>
        <h2 className="song-detail__title">{song.title.ja}</h2>
        {song.composer.ja !== '' && <p className="song-detail__composer">{song.composer.ja}</p>}

        <h3 className="song-detail__heading">譜面</h3>
        <div className="song-detail__arrangements" role="radiogroup" aria-label="譜面">
          {song.arrangements.map((a, i) => {
            const on = a.id === selected.id
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`song-detail__arrangement${on ? ' is-selected' : ''}`}
                onClick={() => choose(a)}
              >
                <span className="song-detail__arrangement-title">{headings[i]!.title}</span>
                <span className="song-detail__arrangement-hands">{headings[i]!.hands}</span>
              </button>
            )
          })}
        </div>

        <div className="song-detail__actions">
          <button type="button" className="song-detail__preview" onClick={togglePreview}>
            {isPreviewing ? '■ 試聴を止める' : '▶ 試聴'}
          </button>
          <button type="button" className="song-detail__play" onClick={play}>
            弾く
          </button>
        </div>
      </div>
    </div>
  )
}
