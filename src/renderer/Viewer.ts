import { Destroyable, react } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { AnnotationLayer } from './AnnotationLayer'
import type { AnnotationRecord, AnnotationStore } from './AnnotationStore'
import type { EmbeddedAudio } from './audioExtract'
import { PageView } from './PageView'

/** 阅读区左右留白，决定「适应宽度」的基准 */
const PAD_X = 32
const NEAR_MARGIN = '700px'
const FAR_MARGIN = '2600px'
const MIN_ZOOM = 0.4
const MAX_ZOOM = 4

export interface ViewerOptions {
  store: AnnotationStore
  onAudioChip: (audio: EmbeddedAudio, chip: HTMLButtonElement, pageView: PageView) => void
  onAnnotationActivate: (record: AnnotationRecord, ev: MouseEvent, pageView: PageView) => void
  /** 页面重建完成（缩放 / 容器变宽），用于让浮动层重新贴合 */
  onRebuilt?: () => void
}

class ViewerBase extends Destroyable {
  constructor(protected _opt: ViewerOptions) {
    super()
  }
}

/**
 * 阅读区：滚动容器 + 页面懒渲染 + 当前页检测 + 缩放。
 * 只渲染可视区附近的页面，离屏页释放位图，60 页文档打开不再是「等全部画完」。
 */
export class Viewer extends ViewerBase {
  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'viewer scroll-thin'
    div.dataset.u32Name = 'viewer'
    return div
  })()

  readonly inner: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'viewer-inner'
    div.dataset.u32Name = 'viewer-inner'
    this.root.appendChild(div)
    return div
  })()

  readonly currentPage = this.disposeVar(react(1))
  readonly totalPages = this.disposeVar(react(0))
  /** 缩放倍率：1 = 适应宽度（顶栏显示 100%） */
  readonly zoom = this.disposeVar(react(1))

  private _pdf: PDFDocumentProxy | null = null
  private _audios: EmbeddedAudio[] = []
  private _pages: PageView[] = []
  private _fitScale = 1
  private _lastWidth = 0
  private _rebuildTimer = 0
  /** pdf.js 注解外观模式（1=画图钉/喇叭外观，0=不画），由 App 的 PDF 注解开关驱动 */
  private _pdfAnnoMode = 1

  /** 近处渲染 */
  private _near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const pv = this._pageOfElement(e.target as HTMLElement)
        void pv?.render()
      }
    },
    { root: this.root, rootMargin: NEAR_MARGIN },
  )

  /** 远处释放 */
  private _far = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) continue
        const pv = this._pageOfElement(e.target as HTMLElement)
        if (pv?.rendered) pv.release()
      }
    },
    { root: this.root, rootMargin: FAR_MARGIN },
  )

  private _scrollScheduled = false
  private _onScroll = () => {
    if (this._scrollScheduled) return
    this._scrollScheduled = true
    requestAnimationFrame(() => {
      this._scrollScheduled = false
      this._detectCurrentPage()
    })
  }

  private _resizeObs = new ResizeObserver(() => {
    // 用 border-box 宽度：滚动条出现/消失不会改变它，避免无谓重建
    const w = this.root.getBoundingClientRect().width
    if (Math.abs(w - this._lastWidth) < 4) return
    this._lastWidth = w
    window.clearTimeout(this._rebuildTimer)
    this._rebuildTimer = window.setTimeout(() => void this.rebuild(), 160)
  })

  private _init = (() => {
    this.root.addEventListener('scroll', this._onScroll, { passive: true })
    this._resizeObs.observe(this.root)
    this.dispose(() => {
      this._near.disconnect()
      this._far.disconnect()
      this._resizeObs.disconnect()
      window.clearTimeout(this._rebuildTimer)
    })
  })()

  get pages(): readonly PageView[] {
    return this._pages
  }

  /** 某页的音频注解（顺序即 PageView.chips 的顺序，重建后可用它找回图标） */
  audiosOf(pageNum: number): EmbeddedAudio[] {
    return this._audios.filter((a) => a.pageNum === pageNum)
  }

  layerOf(pageNum: number): AnnotationLayer | null {
    return this._pages.find((p) => p.pageNum === pageNum)?.annotationLayer ?? null
  }

  async setDocument(pdf: PDFDocumentProxy, audios: EmbeddedAudio[]) {
    this._pdf = pdf
    this._audios = audios
    this._lastWidth = this.root.getBoundingClientRect().width
    this.zoom.value = 1
    this.totalPages.value = pdf.numPages
    this.currentPage.value = 1
    await this.rebuild()
    this.root.scrollTop = 0
  }

  clear() {
    this._pdf = null
    this._audios = []
    this._pages = []
    this._near.disconnect()
    this._far.disconnect()
    this.inner.replaceChildren()
    this.totalPages.value = 0
    this.currentPage.value = 1
  }

  /** 重建全部页面壳（缩放/换文档/容器变宽都会走这里） */
  async rebuild() {
    const pdf = this._pdf
    if (!pdf) return
    // 页锚定：记录视口顶部压住的页面与该页顶部相对视口顶的偏移比例，
    // 重建后把同一页滚回同一相对位置。文档越长越稳，不会像 scrollHeight
    // 比例那样在长文档缩放后跳到别的页。
    const rootTop = this.root.getBoundingClientRect().top
    const prevPage = this.currentPage.value
    const prevPv = this._pages[prevPage - 1]
    const anchorRatio = prevPv
      ? clamp((prevPv.root.getBoundingClientRect().top - rootTop) / Math.max(prevPv.root.getBoundingClientRect().height, 1), -1, 1)
      : 0

    this._near.disconnect()
    this._far.disconnect()
    this._pages = []
    this.inner.replaceChildren()

    const first = await pdf.getPage(1)
    const base = first.getViewport({ scale: 1 })
    this._fitScale = clamp((this.root.getBoundingClientRect().width - PAD_X * 2) / base.width, 0.1, 4)
    const scale = this._fitScale * this.zoom.value

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = i === 1 ? first : await pdf.getPage(i)
      const pv = new PageView({
        pageNum: i,
        page,
        scale,
        audios: this._audios.filter((a) => a.pageNum === i),
        onAudioChip: (audio, chip) => this._opt.onAudioChip(audio, chip, pv),
        onAnnotationActivate: (rec, ev) => this._opt.onAnnotationActivate(rec, ev, pv),
        annotationMode: () => this._pdfAnnoMode,
      })
      pv.renderAnnotations(this._opt.store.byPage(i))
      this.inner.appendChild(pv.root)
      this._pages.push(pv)
      this._near.observe(pv.root)
      this._far.observe(pv.root)
    }

    // 尺寸变化后按页锚定还原滚动位置：同一页回到同一相对位置
    const anchor = this._pages[prevPage - 1] ?? this._pages[0]
    if (anchor) {
      const newRootTop = this.root.getBoundingClientRect().top
      const top =
        anchor.root.getBoundingClientRect().top - newRootTop + this.root.scrollTop
      this.root.scrollTop = Math.max(
        top - anchorRatio * anchor.root.getBoundingClientRect().height,
        0,
      )
    }
    this.currentPage.value = Math.min(prevPage, pdf.numPages)
    this._detectCurrentPage()
    // 首屏不等 IntersectionObserver：立刻画当前页，打开就有内容
    const current = this._pages[this.currentPage.value - 1] ?? this._pages[0]
    void current?.render()
    this._opt.onRebuilt?.()
  }

  /** 批注变化后只重画批注层 */
  repaintAnnotations() {
    for (const pv of this._pages) pv.renderAnnotations(this._opt.store.byPage(pv.pageNum))
  }

  /**
   * PDF 注解显隐：0 = 不画注解外观（附件图钉等），否则按 pdf.js AnnotationMode。
   * 已渲染的页面要释放重画才能抹掉 canvas 里的像素。
   */
  setPdfAnnotationMode(mode: number) {
    this._pdfAnnoMode = mode
    for (const pv of this._pages) pv.setAnnotationMode(mode)
    // 只重画已渲染的页；离屏页释放后自然按新模式画
    for (const pv of this._pages) {
      if (pv.rendered) void pv.rerender()
    }
  }

  zoomIn() {
    this.setZoom(this.zoom.value * 1.15)
  }

  zoomOut() {
    this.setZoom(this.zoom.value / 1.15)
  }

  fitWidth() {
    this.setZoom(1)
  }

  setZoom(next: number) {
    const clamped = clamp(Math.round(next * 100) / 100, MIN_ZOOM, MAX_ZOOM)
    if (Math.abs(clamped - this.zoom.value) < 0.005) return
    this.zoom.value = clamped
    void this.rebuild()
  }

  scrollToPage(pageNum: number) {
    const pv = this._pages[pageNum - 1]
    if (!pv) return
    const top =
      pv.root.getBoundingClientRect().top - this.root.getBoundingClientRect().top + this.root.scrollTop
    this.root.scrollTop = Math.max(top - 16, 0)
    this.currentPage.value = pageNum
    void pv.render()
  }

  private _pageOfElement(el: HTMLElement): PageView | undefined {
    const n = Number(el.dataset.page)
    return this._pages.find((p) => p.pageNum === n)
  }

  private _detectCurrentPage() {
    const rootTop = this.root.getBoundingClientRect().top
    let current = this.currentPage.value
    for (const pv of this._pages) {
      const top = pv.root.getBoundingClientRect().top - rootTop
      if (top - 100 <= 0) current = pv.pageNum
      else break
    }
    if (current !== this.currentPage.value) this.currentPage.value = current
    for (const pv of this._pages) pv.setCurrent(pv.pageNum === current)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
