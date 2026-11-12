// 弾き終わりのカード（手本: App/Views/FinishCard.swift）。演奏画面に暗い幕を敷いて重ねる。
// 幅が広ければ 2 つのボタンを横に、狭ければ縦に並べる（CSS の container query）。
import { useEffect, useRef, type ReactElement } from 'react'
import { timeText } from './playViewLogic'
import './FinishCard.css'

export interface FinishCardProps {
  songTitle: string
  /** かかった時間（秒） */
  elapsed: number
  /** 違う鍵を押した回数 */
  wrongCount: number
  onRetry(): void
  onBackToList(): void
}

export function FinishCard({ songTitle, elapsed, wrongCount, onRetry, onBackToList }: FinishCardProps): ReactElement {
  const retryRef = useRef<HTMLButtonElement>(null)
  // 出たら「もう一度」へフォーカスを移し、Esc は「曲に戻る」と同じにする
  const backRef = useRef(onBackToList)
  backRef.current = onBackToList
  useEffect(() => {
    retryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') backRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="finish-scrim">
      <div className="finish-card" role="dialog" aria-modal="true" aria-label="弾けました">
        <h2 className="finish-title">弾けました</h2>
        <p className="finish-song">{songTitle}</p>
        <dl className="finish-rows">
          <div className="finish-row">
            <dt>かかった時間</dt>
            <dd>{timeText(elapsed)}</dd>
          </div>
          <div className="finish-row">
            <dt>違う鍵を押した回数</dt>
            <dd>{wrongCount}</dd>
          </div>
        </dl>
        <div className="finish-buttons">
          <button type="button" className="finish-retry" ref={retryRef} onClick={onRetry}>
            もう一度
          </button>
          <button type="button" className="finish-back" onClick={onBackToList}>
            曲に戻る
          </button>
        </div>
      </div>
    </div>
  )
}
