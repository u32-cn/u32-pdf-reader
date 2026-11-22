import { Destroyable, react } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { EmbeddedAudio } from './audioExtract'

const CSS_PREFIX = 'u32--audio-bar-ui--root--1763799200000'

const SPEEDS = [0.5, 1, 1.25, 1.5, 2]

/** 底部音频播放条：进度条可拖拽 + 倍速，不循环 */
export class AudioBar extends Destroyable {
  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = CSS_PREFIX
    div.dataset.u32Name = 'audio-bar'
    div.style.display = 'none'
    return div
  })()

  private _audio: HTMLAudioElement | null = null

  /** 当前播放的音频（null = 未在播放） */
  private _current = this.disposeVar(react<EmbeddedAudio | null>(null))
  get current() { return this._current.value }
  get currentChanged() { return this._current.changed }

  /** 播放速率 */
  private _speed = this.disposeVar(react(1))
  get speed() { return this._speed.value }

  private _playing = this.disposeVar(react(false))
  get playing() { return this._playing.value }

  private _playBtn = (() => {
    const btn = document.createElement('button')
    btn.dataset.u32Name = 'audio-bar-play'
    btn.textContent = '▶'
    return btn
  })()

  private _progress = (() => {
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = '1000'
    input.value = '0'
    input.dataset.u32Name = 'audio-bar-progress'
    input.style.flex = '1'
    return input
  })()

  private _timeLabel = (() => {
    const span = document.createElement('span')
    span.dataset.u32Name = 'audio-bar-time'
    span.textContent = '0:00 / 0:00'
    return span
  })()

  private _speedBtn = (() => {
    const btn = document.createElement('button')
    btn.dataset.u32Name = 'audio-bar-speed'
    btn.textContent = '1x'
    return btn
  })()

  private _title = (() => {
    const span = document.createElement('span')
    span.dataset.u32Name = 'audio-bar-title'
    span.style.maxWidth = '200px'
    span.style.overflow = 'hidden'
    span.style.textOverflow = 'ellipsis'
    span.style.whiteSpace = 'nowrap'
    return span
  })()

  private _rootChildren = (() => {
    this.root.appendChild(this._playBtn)
    this.root.appendChild(this._title)
    this.root.appendChild(this._progress)
    this.root.appendChild(this._timeLabel)
    this.root.appendChild(this._speedBtn)

    this._playBtn.addEventListener('click', () => this.toggle())
    this._speedBtn.addEventListener('click', () => {
      const idx = SPEEDS.indexOf(this._speed.value)
      const next = SPEEDS[(idx + 1) % SPEEDS.length]
      this._speed.value = next
      if (this._audio) this._audio.playbackRate = next
    })
    // 拖动进度条 seek
    this._progress.addEventListener('input', () => {
      if (!this._audio || !this._audio.duration) return
      const ratio = Number(this._progress.value) / 1000
      this._audio.currentTime = ratio * this._audio.duration
    })

    // 视图 watch 状态驱动显示（规则7）
    this.dispose(this._speed.changed.disposableOn((v) => {
      this._speedBtn.textContent = `${v}x`
    }))
    this.dispose(this._current.changed.disposableOn((v) => {
      if (v) {
        this.root.style.display = 'flex'
        this._title.textContent = v.title
        this._title.title = v.title
      } else {
        this.root.style.display = 'none'
        if (this._audio) {
          this._audio.pause()
          this._audio = null
        }
      }
    }))
    return true
  })()

  /** 播放指定音频（替换当前） */
  play(audio: EmbeddedAudio) {
    if (this._audio) {
      this._audio.pause()
      URL.revokeObjectURL(this._audio.src)
    }
    const blob = new Blob([audio.bytes as BlobPart], { type: audio.mime })
    const el = new Audio(URL.createObjectURL(blob))
    el.playbackRate = this._speed.value
    el.addEventListener('timeupdate', () => this._updateProgress())
    el.addEventListener('ended', () => {
      this._playing.value = false
      this._playBtn.textContent = '▶'
    })
    el.play()
    this._audio = el
    this._playing.value = true
    this._playBtn.textContent = '⏸'
    this._current.value = audio
  }

  toggle() {
    if (!this._audio) return
    if (this._audio.paused) {
      this._audio.play()
      this._playing.value = true
      this._playBtn.textContent = '⏸'
    } else {
      this._audio.pause()
      this._playing.value = false
      this._playBtn.textContent = '▶'
    }
  }

  private _updateProgress() {
    if (!this._audio) return
    const dur = this._audio.duration || 0
    const cur = this._audio.currentTime
    if (dur > 0) this._progress.value = String(Math.round((cur / dur) * 1000))
    this._timeLabel.textContent = `${fmt(cur)} / ${fmt(dur)}`
  }
}

function fmt(sec: number): string {
  const s = Math.floor(sec % 60)
  const m = Math.floor(sec / 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
