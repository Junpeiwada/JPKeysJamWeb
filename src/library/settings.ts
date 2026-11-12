import type { PlayHands } from '../guide/hand'
import type { KeyRangePreference } from '../guide/keyRange'
import type { StorageLike } from './history'

export const SETTINGS_KEY = 'jpkeysjam.settings'

const KEY_RANGES: readonly KeyRangePreference[] = ['auto', 'keys13', 'keys25']
const HANDS: readonly PlayHands[] = ['leftOnly', 'both', 'rightOnly']

/** 保存する中身 */
interface SettingsData {
  keyRange: KeyRangePreference
  hands: PlayHands
  oneNote: boolean
  /** 曲ごとに選んだ譜面の ID（曲の ID → 譜面の ID） */
  arrangements: Record<string, string>
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function defaults(): SettingsData {
  // 弾く手の既定は右手だけ（iOS 版に合わせる）
  return { keyRange: 'auto', hands: 'rightOnly', oneNote: false, arrangements: {} }
}

/** アプリの設定。鍵盤数・弾く手・1 音で OK・曲ごとの譜面。
 *  変更のたびに保存し、購読者へ知らせる。読めない値・知らない値は既定値に戻す */
export class AppSettings {
  private data: SettingsData
  private listeners = new Set<() => void>()

  constructor(
    private readonly storage: StorageLike | null = defaultStorage(),
    private readonly key: string = SETTINGS_KEY,
  ) {
    this.data = this.load()
  }

  get keyRange(): KeyRangePreference {
    return this.data.keyRange
  }
  set keyRange(v: KeyRangePreference) {
    if (!KEY_RANGES.includes(v)) return
    this.data.keyRange = v
    this.commit()
  }

  get hands(): PlayHands {
    return this.data.hands
  }
  set hands(v: PlayHands) {
    if (!HANDS.includes(v)) return
    this.data.hands = v
    this.commit()
  }

  get oneNote(): boolean {
    return this.data.oneNote
  }
  set oneNote(v: boolean) {
    this.data.oneNote = v
    this.commit()
  }

  /** 曲で選んだ譜面の ID。選んでいなければ undefined */
  arrangementFor(songID: string): string | undefined {
    return Object.hasOwn(this.data.arrangements, songID) ? this.data.arrangements[songID] : undefined
  }

  setArrangement(songID: string, arrangementID: string): void {
    this.data.arrangements[songID] = arrangementID
    this.commit()
  }

  /** 変更を購読する。解除関数を返す（React の useSyncExternalStore 向け） */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private commit(): void {
    this.save()
    for (const l of [...this.listeners]) l()
  }

  private load(): SettingsData {
    const result = defaults()
    try {
      const raw = this.storage?.getItem(this.key)
      if (!raw) return result
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return result
      const p = parsed as Record<string, unknown>
      if (KEY_RANGES.includes(p.keyRange as KeyRangePreference)) result.keyRange = p.keyRange as KeyRangePreference
      if (HANDS.includes(p.hands as PlayHands)) result.hands = p.hands as PlayHands
      if (typeof p.oneNote === 'boolean') result.oneNote = p.oneNote
      if (typeof p.arrangements === 'object' && p.arrangements !== null && !Array.isArray(p.arrangements)) {
        // 文字列でない値が混じっても、ほかの曲の選択は残す
        for (const [k, v] of Object.entries(p.arrangements)) {
          if (typeof v === 'string') result.arrangements[k] = v
        }
      }
    } catch {
      return defaults()
    }
    return result
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.data))
    } catch {
      // 書き込めなくてもメモリ上では動かす
    }
  }
}
