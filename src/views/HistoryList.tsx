import { useEffect, useRef, useState } from 'react'
import type { SongCatalog } from '../library/catalog'
import type { PlayHistory } from '../library/history'
import { arrangementText, groupRecords, historyDayTitle, timeText, visibleRecords } from './historyLogic'
import './HistoryList.css'

export interface HistoryListProps {
  catalog: SongCatalog
  history: PlayHistory
  onSelect(songID: string): void
  /** 消したあとに呼ぶ（親が履歴を読み直す） */
  onChange(): void
  /** 今（epoch ms）。省略すると現在時刻 */
  now?: number
}

/** 履歴の一覧。今日・昨日・それより前で区切り、新しい順。1 件消す・すべて消す（確認つき） */
export function HistoryList({ catalog, history, onSelect, onChange, now }: HistoryListProps) {
  const [confirming, setConfirming] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 確認が出たら「キャンセル」へフォーカスし、Esc で閉じる
  useEffect(() => {
    if (!confirming) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])
  const all = history.all()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const current = now ?? Date.now()
  const groups = groupRecords(visibleRecords(all, catalog), current, timeZone)

  return (
    <div className="history">
      {/* 見える行が無くても、非公開の曲の記録が残っていれば消せるようにする */}
      {all.length > 0 && (
        <div className="history__bar">
          <button type="button" className="history__clear" onClick={() => setConfirming(true)}>
            すべて消す
          </button>
          {confirming && (
            <div className="history__confirm" role="alertdialog" aria-label="履歴をすべて消しますか？">
              <p className="history__confirm-text">履歴をすべて消しますか？</p>
              <div className="history__confirm-buttons">
                <button type="button" ref={cancelRef} className="history__cancel" onClick={() => setConfirming(false)}>
                  キャンセル
                </button>
                <button
                  type="button"
                  className="history__danger"
                  onClick={() => {
                    history.clearAll()
                    setConfirming(false)
                    onChange()
                  }}
                >
                  すべて消す
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {groups.length === 0 && <p className="history__empty">弾いた曲がここに残ります</p>}
      {groups.map((group) => (
        <section key={group.day} className="history__group">
          <h2 className="history__heading">{historyDayTitle(group.day)}</h2>
          <ul className="history__list">
            {group.records.map((r) => {
              const entry = catalog.song(r.songID)
              if (!entry) return null
              const arrangement = arrangementText(r, entry)
              return (
                <li key={r.id} className="history__row">
                  <button type="button" className="history__song" onClick={() => onSelect(entry.id)}>
                    <span className="history__title">
                      <span className="history__title-text">{entry.title.ja}</span>
                      {arrangement && <span className="history__sub">{arrangement}</span>}
                    </span>
                    <span className="history__time">{timeText(r.playedAt, group.day, current, timeZone)}</span>
                  </button>
                  <button
                    type="button"
                    className="history__remove"
                    aria-label={`${entry.title.ja}の記録を消す`}
                    onClick={() => {
                      history.remove(r.id)
                      onChange()
                    }}
                  >
                    消す
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
