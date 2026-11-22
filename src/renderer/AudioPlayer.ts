import { Destroyable, react } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { EmbeddedAudio } from './audioExtract'
import { icons } from './icons'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const GAP = 8
const EDGE = 6

export interface AudioPlayerOptions {
  onOpenChange?: (open: boolean) => void
}

class AudioPlayerBase extends Destroyable {
  constructor(protected _opt: AudioPlayerOptions) {
    super()
  }
}

/**
 * 浮动播放条：挂在被点击图标所在的页面容器内、锚在该图标下方。
 * 随页面一起滚动；靠页面底部时自动翻到图标上方；同一时刻只播一个音源。
 */
export class AudioPlayer extends AudioPlayerBase {
  readonly current = this.disposeVar(react<EmbeddedAudio | null>(null))
  readonly playing = this.disposeVar(react(false))
  readonly speed = this.disposeVar(react(1))

  private readonly _playBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'play-btn'
    btn.dataset.u32Name = 'audio-bar-play'
    btn.title = '播放 / 暂停'
    btn.textContent = '▶'
    btn.addEventListener('click', () => this.toggle())
    return btn
  })()

  private readonly _title = (() => {
    const span = document.createElement('span')
    span.className = 'pop-title'
    span.dataset.u32Name = 'audio-bar-title'
    return span
  })()

  private readonly _closeBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'pop-close'
    btn.dataset.u32Name = 'audio-bar-close'
    btn.title = '收起播放条（Esc）'
    btn.innerHTML = icons.close
    btn.addEventListener('click', () => this.close())
    return btn
  })()

  private readonly _fill = (() => {
    const i = document.createElement('i')
    i.dataset.u32Name = 'audio-bar-fill'
    return i
  })()

  private readonly _knob = (() => {
    const b = document.createElement('b')
    b.dataset.u32Name = 'audio-bar-knob'
    return b
  })()

  private readonly _track = (() => {
    const div = document.createElement('div')
    div.className = 'track'
    div.dataset.u32Name = 'audio-bar-progress'
    div.appendChild(this._fill)
    div.appendChild(this._knob)
    div.addEventListener('pointerdown', (e) => {
      if (!this._audio) return
      div.setPointerCapture(e.pointerId)
      this._seekTo(e.clientX)
      const move = (ev: PointerEvent) => this._seekTo(ev.clientX)
      const up = () => {
        div.removeEventListener('pointermove', move)
        div.removeEventListener('pointerup', up)
      }
      div.addEventListener('pointermove', move)
      div.addEventListener('pointerup', up)
    })
    return div
  })()

  private readonly _time = (() => {
    const span = document.createElement('span')
    span.className = 'time'
    span.dataset.u32Name = 'audio-bar-time'
    span.textContent = '0:00 / 0:00'
    return span
  })()

  private readonly _speedBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'speed'
    btn.dataset.u32Name = 'audio-bar-speed'
    btn.title = '播放速度'
    btn.textContent = '1x'
    btn.addEventListener('click', () => {
      const idx = SPEEDS.indexOf(this.speed.value)
      const next = SPEEDS[(idx + 1) % SPEEDS.length]
      this.speed.value = next
      if (this._audio) this._audio.playbackRate = next
    })
    return btn
  })()

  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'pop-player'
    div.dataset.u32Name = 'audio-bar'
    div.dataset.open = 'false'
    div.style.display = 'none'

    const row1 = document.createElement('div')
    row1.className = 'pop-row'
    row1.dataset.u32Name = 'audio-bar-row-1'
    row1.appendChild(this._playBtn)
    row1.appendChild(this._title)
    row1.appendChild(this._closeBtn)

    const row2 = document.createElement('div')
    row2.className = 'pop-row'
    row2.dataset.u32Name = 'audio-bar-row-2'
    row2.appendChild(this._track)
    row2.appendChild(this._time)
    row2.appendChild(this._speedBtn)

    div.appendChild(row1)
    div.appendChild(row2)
    return div
  })()

  private _audio: HTMLAudioElement | null = null
  private _objectUrl: string | null = null
  private _chip: HTMLButtonElement | null = null

  private _initWatches = (() => {
    this.dispose(
      this.speed.changed.disposableOn((v) => {
        this._speedBtn.textContent = `${v}x`
      }),
    )
    this.dispose(() => this._destroyAudio())
  })()

  get isOpen() {
    return this.root.dataset.open === 'true'
  }

  /** 打开（或迁移到）指定图标下方并播放 */
  open(audio: EmbeddedAudio, chip: HTMLButtonElement) {
    const page = chip.closest('.page-shell') as HTMLElement | null
    if (!page) return
    if (this.root.parentElement !== page) page.appendChild(this.root)

    if (this._chip && this._chip !== chip) this._chip.setAttribute('aria-pressed', 'false')
    this._chip = chip
    chip.setAttribute('aria-pressed', 'true')

    this._title.textContent = audio.title
    this._title.title = audio.title
    this.root.dataset.open = 'true'
    this.root.style.display = 'flex'

    if (this.current.value !== audio) {
      this._destroyAudio()
      this.current.value = audio
      this._start(audio)
    } else if (this._audio?.paused) {
      void this._audio.play()
      this.playing.value = true
      this._playBtn.textContent = '⏸'
    }

    this._place(page, chip)
    this._opt.onOpenChange?.(true)
  }

  close() {
    if (!this.isOpen) return
    this._destroyAudio()
    this.current.value = null
    this.playing.value = false
    this._playBtn.textContent = '▶'
    this.root.dataset.open = 'false'
    this.root.style.display = 'none'
    this._chip?.setAttribute('aria-pressed', 'false')
    this._chip = null
    this._opt.onOpenChange?.(false)
  }

  toggle() {
    if (!this._audio) return
    if (this._audio.paused) {
      void this._audio.play()
      this.playing.value = true
      this._playBtn.textContent = '⏸'
    } else {
      this._audio.pause()
      this.playing.value = false
      this._playBtn.textContent = '▶'
    }
  }

  /** 页面尺寸/缩放变化后重新贴合图标 */
  reposition() {
    const chip = this._chip
    const page = this.root.parentElement as HTMLElement | null
    if (!chip || !page || !this.isOpen) return
    this._place(page, chip)
  }

  private _place(page: HTMLElement, chip: HTMLElement) {
    const pageW = page.clientWidth
    const pageH = page.clientHeight
    const w = this.root.offsetWidth || 302
    const h = this.root.offsetHeight || 76
    const chipLeft = chip.offsetLeft
    const chipTop = chip.offsetTop
    const chipSize = chip.offsetWidth

    const maxLeft = Math.max(pageW - w - EDGE, EDGE)
    const left = clamp(chipLeft + chipSize / 2 - w / 2, EDGE, maxLeft)

    let top = chipTop + chipSize + GAP
    if (top + h > pageH - EDGE) top = chipTop - h - GAP
    if (top < EDGE) top = Math.min(chipTop + chipSize + GAP, Math.max(pageH - h - EDGE, EDGE))

    this.root.style.left = `${Math.round(left)}px`
    this.root.style.top = `${Math.round(top)}px`
  }

  private _start(audio: EmbeddedAudio) {
    const blob = new Blob([audio.bytes as BlobPart], { type: audio.mime })
    const url = URL.createObjectURL(blob)
    this._objectUrl = url
    const el = new Audio(url)
    el.playbackRate = this.speed.value
    el.addEventListener('timeupdate', () => this._sync())
    el.addEventListener('loadedmetadata', () => this._sync())
    el.addEventListener('ended', () => {
      this.playing.value = false
      this._playBtn.textContent = '▶'
      this._sync()
    })
    el.addEventListener('error', () => {
      this._title.textContent = '音频无法解码'
      this.playing.value = false
      this._playBtn.textContent = '▶'
    })
    el.play().catch(() => {
      this.playing.value = false
      this._playBtn.textContent = '▶'
    })
    this._audio = el
    this.playing.value = true
    this._playBtn.textContent = '⏸'
    this._sync()
  }

  private _destroyAudio() {
    const el = this._audio
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl)
      this._objectUrl = null
    }
    this._audio = null
    this._fill.style.width = '0%'
    this._knob.style.left = '0%'
    this._time.textContent = '0:00 / 0:00'
  }

  private _seekTo(clientX: number) {
    const el = this._audio
    if (!el || !el.duration) return
    const rect = this._track.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
    el.currentTime = ratio * el.duration
    this._sync()
  }

  private _sync() {
    const el = this._audio
    if (!el) return
    const dur = Number.isFinite(el.duration) ? el.duration : 0
    const cur = el.currentTime || 0
    const pct = dur > 0 ? clamp(cur / dur, 0, 1) * 100 : 0
    this._fill.style.width = `${pct}%`
    this._knob.style.left = `${pct}%`
    this._time.textContent = `${formatTime(cur)} / ${formatTime(dur)}`
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const s = total % 60
  const m = Math.floor(total / 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
