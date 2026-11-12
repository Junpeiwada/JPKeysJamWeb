// 手の分け方（手本: App/Guide/Hand.swift）。13 鍵 × 2 台の byChannel は移さない。

/** 弾く手 */
export type Hand = 'left' | 'right'

/** 右手だけ・左手だけ・両手のどれで弾くか */
export type PlayHands = 'leftOnly' | 'both' | 'rightOnly'

/** 演奏画面の選択肢の並び（左手・両手・右手） */
export const PLAY_HANDS: readonly PlayHands[] = ['leftOnly', 'both', 'rightOnly']

/** 入力のノート番号から手を決める方法 */
export type HandSplit =
  /** 分けない（全部右手） */
  | { kind: 'none' }
  /** lowestRight 未満が左手、以上が右手（25 鍵では 60 = C4） */
  | { kind: 'byNote'; lowestRight: number }

/** ノート番号から手を決める */
export function handFor(split: HandSplit, note: number): Hand {
  switch (split.kind) {
    case 'none':
      return 'right'
    case 'byNote':
      return note < split.lowestRight ? 'left' : 'right'
  }
}
