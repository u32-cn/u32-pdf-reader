import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import { TextLayer } from 'pdfjs-dist'
import type { PDFPageProxy, PageViewport, RenderTask } from 'pdfjs-dist'
import { AnnotationLayer } from './AnnotationLayer'
import type { AnnotationRecord } from './AnnotationStore'
import type { EmbeddedAudio } from './audioExtract'

const CHIP_SIZE = 26

export interface PageViewOptions {
  pageNum: number
  page: PDFPageProxy
  scale: number
  audios: EmbeddedAudio[]
  onAudioChip: (audio: EmbeddedAudio, chip: HTMLButtonElement) => void
  onAnnotationActivate: (record: AnnotationRecord, ev: MouseEvent) => void
}

class PageViewBase extends Destroyable {
  constructor(protected _opt: PageViewOptions) {
    super()
  }
}

/**
 * 单页三层结构：canvas（像素）→ textLayer（可选中透明文字）→ annotationLayer（批注 DOM）。
 * 页面尺寸由 `page.getViewport({ scale })` 决定，不再假设固定 612×792。
 */
export class PageView extends PageViewBase {
  readonly viewport: PageViewport = this._opt.page.getViewport({ scale: this._opt.scale })

  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'page-shell'
    div.dataset.u32Name = `page-${this._opt.pageNum}`
    div.dataset.page = String(this._opt.pageNum)
    div.dataset.rendered = 'false'
    div.style.width = `${Math.floor(this.viewport.width)}px`
    div.style.height = `${Math.floor(this.viewport.height)}px`
    div.style.setProperty('--scale-factor', String(this._opt.scale))
    return div
  })()

  /** 文本层容器（pdf.js TextLayer 往这里塞 span） */
  private readonly _textRoot: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'textLayer'
    div.dataset.u32Name = `text-layer-${this._opt.pageNum}`
    this.root.appendChild(div)
    return div
  })()

  readonly annotationLayer: AnnotationLayer = (() => {
    const layer = new AnnotationLayer({
      page: this._opt.pageNum,
      onActivate: this._opt.onAnnotationActivate,
    })
    this.root.appendChild(layer.root)
    return layer
  })()

  /** 音频图标 → 供播放条定位（offsetParent 即页面容器） */
  readonly chips: HTMLButtonElement[] = (() => {
    const out: HTMLButtonElement[] = []
    for (const audio of this._opt.audios) out.push(this._makeChip(audio))
    return out
  })()

  private _canvas: HTMLCanvasElement | null = null
  private _renderTask: RenderTask | null = null
  private _textLayerTask: TextLayer | null = null
  private _rendered = false
  private _rendering = false
  private _token = 0

  get pageNum() {
    return this._opt.pageNum
  }

  get rendered() {
    return this._rendered
  }

  renderAnnotations(records: AnnotationRecord[]) {
    this.annotationLayer.render(records)
  }

  setCurrent(current: boolean) {
    if (current) this.root.dataset.current = 'true'
    else delete this.root.dataset.current
  }

  async render() {
    if (this._rendering || this._rendered) return
    this._rendering = true
    const token = ++this._token
    const viewport = this.viewport
    const dpr = window.devicePixelRatio || 1

    const canvas = document.createElement('canvas')
    canvas.className = 'page-canvas'
    canvas.dataset.u32Name = `canvas-${this._opt.pageNum}`
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    this.root.insertBefore(canvas, this.root.firstChild)
    this._canvas = canvas

    const task = this._opt.page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    })
    this._renderTask = task

    try {
      await task.promise
      if (token !== this._token) return
      const textLayer = new TextLayer({
        textContentSource: this._opt.page.streamTextContent(),
        container: this._textRoot,
        viewport,
      })
      this._textLayerTask = textLayer
      await textLayer.render()
      if (token !== this._token) return
      this._rendered = true
      this.root.dataset.rendered = 'true'
    } catch {
      // 离开可视区导致的取消：静默
    } finally {
      if (token === this._token) this._rendering = false
    }
  }

  /** 释放位图与文本层，保留页面占位，避免大文档吃满内存 */
  release() {
    this._token++
    this._renderTask?.cancel()
    this._renderTask = null
    this._textLayerTask?.cancel()
    this._textLayerTask = null
    this._textRoot.replaceChildren()
    if (this._canvas) {
      this._canvas.width = 0
      this._canvas.height = 0
      this._canvas.remove()
      this._canvas = null
    }
    this._rendered = false
    this._rendering = false
    this.root.dataset.rendered = 'false'
  }

  private _makeChip(audio: EmbeddedAudio): HTMLButtonElement {
    const vp = this.viewport
    const [ax0, ay0, ax1, ay1] = audio.rect
    const p1 = vp.convertToViewportPoint(Math.min(ax0, ax1), Math.min(ay0, ay1))
    const p2 = vp.convertToViewportPoint(Math.max(ax0, ax1), Math.max(ay0, ay1))
    const cx = (p1[0] + p2[0]) / 2
    const cy = (p1[1] + p2[1]) / 2
    const maxX = Math.max(vp.width - CHIP_SIZE - 2, 2)
    const maxY = Math.max(vp.height - CHIP_SIZE - 2, 2)

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'audio-chip'
    btn.dataset.u32Name = 'audio-icon'
    btn.setAttribute('aria-pressed', 'false')
    btn.title = audio.title
    btn.style.left = `${clamp(cx - CHIP_SIZE / 2, 2, maxX)}px`
    btn.style.top = `${clamp(cy - CHIP_SIZE / 2, 2, maxY)}px`
    btn.innerHTML =
      '<span class="ring"></span>' +
      '<svg viewBox="0 0 12 12" width="9" height="9" fill="currentColor" aria-hidden="true">' +
      '<path d="M3.6 2.3v7.4L9.4 6Z"/></svg>'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      this._opt.onAudioChip(audio, btn)
    })
    this.root.appendChild(btn)
    return btn
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
