// 曲の試聴。手本は JPKeysJam の App/Engine/PreviewPlayer.swift。
// 演奏用とは別の SmfPlayer を音源につなぎ、鳴らすのは 1 曲だけにする。弾くパート（ch1）もミュートせずに鳴らす。
// 20 秒の長さは previews/<id>.mid 自体が持つ（make_songs.py が 20 秒に切り出している）。Swift と同じく、ここでは時間で切らず SMF の終わりで止まる。
// Swift との違い: progress は持たない（Web の試聴ボタンは再生位置を出さないため）。
import { parseSmf, type SmfSong } from '../midi/smf'
import { audioEngine } from './engine'
import { SmfPlayer, type PlayerClock, type PlayerSink } from './smfPlayer'

export interface PreviewPlayerOptions {
  /** 音の出口。既定は audioEngine.send */
  sink?: PlayerSink
  /** テストで差し替える fetch。既定はグローバルの fetch */
  fetchFn?: (url: string) => Promise<Response>
  clock?: PlayerClock
  /** false ならタイマーを作らない（テストが player.tick() 相当を手で呼ぶ） */
  usesTimer?: boolean
  /** 試聴 SMF の置き場所。既定は `${BASE_URL}songs/previews/` */
  baseUrl?: string
}

type Listener = (playingID: string | null) => void

export class PreviewPlayer {
  private readonly player: SmfPlayer
  private readonly fetchFn: (url: string) => Promise<Response>
  private readonly baseUrl: string
  private currentID: string | null = null
  /** 要求の世代。stop() と鳴らし始めるたびに進む。読み込みの待ち中に止められた要求を鳴らさないために使う */
  private generationValue = 0
  private readonly listeners = new Set<Listener>()

  /**
   * 鳴らしていた試聴が止まったときに呼ぶ（stop() でも、最後まで鳴って自分で止まったときでも 1 回）。
   * 試聴の SMF が ch1 に残した Program Change・CC を、呼び出し側が戻すのに使う
   */
  onStopped: (() => void) | null = null

  constructor(options: PreviewPlayerOptions = {}) {
    this.player = new SmfPlayer(options.sink ?? ((message) => audioEngine.send(message)), {
      clock: options.clock,
      usesTimer: options.usesTimer,
    })
    this.fetchFn = options.fetchFn ?? ((url) => fetch(url))
    this.baseUrl = options.baseUrl ?? `${import.meta.env.BASE_URL}songs/previews/`
    // 最後まで行って自分で止まったとき
    this.player.onFinished = () => {
      this.stop()
    }
  }

  /** 鳴らしている曲の ID。止まっていれば null */
  get playingID(): string | null {
    return this.currentID
  }

  get generation(): number {
    return this.generationValue
  }

  /** 内部の SmfPlayer（テストで tick を手で進めるために公開） */
  get smfPlayer(): SmfPlayer {
    return this.player
  }

  /** playingID の変化を購読する。戻り値で解除（React の useSyncExternalStore 用） */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 今の世代を受け取る。読み込みの前に取り、読み込み後に playSong の token へ渡す */
  request(): number {
    return this.generationValue
  }

  /** 試聴 SMF を読み込んで鳴らす。鳴っていれば先に止める。読み込み中に stop() や別の play() があれば鳴らさない。鳴らしたら true */
  async play(songID: string): Promise<boolean> {
    // 先に前の曲を止め、世代を進める（読み込みの待ち中に別の曲が押されても古い要求を捨てられる）
    this.stop()
    const token = this.generationValue
    let song: SmfSong
    try {
      const response = await this.fetchFn(`${this.baseUrl}${songID}.mid`)
      if (!response.ok) {
        console.warn('試聴の読み込みに失敗', songID, response.status)
        return false
      }
      song = parseSmf(new Uint8Array(await response.arrayBuffer()))
    } catch (error) {
      console.warn('試聴の読み込みに失敗', songID, error)
      return false
    }
    return this.playSong(song, songID, token)
  }

  /** 世代が token（request() の値）から変わっていなければ鳴らす。token を省くと必ず鳴らす。変わっていれば鳴らさず false */
  playSong(song: SmfSong, id: string, token?: number): boolean {
    if (token !== undefined && token !== this.generationValue) return false
    this.stop()
    this.generationValue += 1
    if (song.duration <= 0) return false
    this.player.load(song)
    this.player.play()
    this.setPlaying(id)
    return true
  }

  /** 鳴っている音を全部止める。止まっていても呼んでよい */
  stop(): void {
    this.generationValue += 1
    this.player.stop()
    const wasPlaying = this.currentID !== null
    if (wasPlaying) {
      this.setPlaying(null)
      this.onStopped?.()
    }
  }

  private setPlaying(id: string | null): void {
    this.currentID = id
    for (const listener of [...this.listeners]) listener(id)
  }
}
