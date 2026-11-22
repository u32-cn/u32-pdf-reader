import { Destroyable, watch } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { ReactiveVariable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AnnotationRecord } from './AnnotationStore'
import { icons } from './icons'

const THUMB_W = 128
const TYPE_LABEL: Record<string, string> = {
  highlight: '高亮',
  underline: '下划线',
  note: '便签',
  text: '文字',
}

export interface SidebarOptions {
  pdf: () => PDFDocumentProxy | null
  records: ReactiveVariable<AnnotationRecord[]>
  currentPage: ReactiveVariable<number>
  onGoToPage: (n: number) => void
  onActivateAnnotation: (record: AnnotationRecord) => void
  onDeleteAnnotation: (id: string) => void
}

class SidebarBase extends Destroyable {
  constructor(protected _opt: SidebarOptions) {
    super()
  }
}

type Tab = 'thumbs' | 'anno'

/**
 * 左侧栏：缩略图 / 批注两栏，缩略图按需渲染（滚到附近才画）。
 */
export class Sidebar extends SidebarBase {
  private readonly _tabThumbs: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'side-tab'
    btn.dataset.u32Name = 'side-tab-thumbs'
    btn.dataset.tab = 'thumbs'
    btn.textContent = '缩略图'
    btn.setAttribute('aria-selected', 'true')
    btn.addEventListener('click', () => this._setTab('thumbs'))
    return btn
  })()

  private readonly _tabAnno: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'side-tab'
    btn.dataset.u32Name = 'side-tab-anno'
    btn.dataset.tab = 'anno'
    btn.textContent = '批注'
    btn.setAttribute('aria-selected', 'false')
    btn.addEventListener('click', () => this._setTab('anno'))
    return btn
  })()

  private readonly _thumbs: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'thumbs'
    div.dataset.u32Name = 'thumbs'
    return div
  })()

  private readonly _annoList: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'anno-list'
    div.dataset.u32Name = 'anno-list'
    return div
  })()

  private readonly _thumbsPane: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'side-pane scroll-thin'
    div.dataset.u32Name = 'side-pane-thumbs'
    div.dataset.pane = 'thumbs'
    div.appendChild(this._thumbs)
    return div
  })()

  private readonly _annoPane: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'side-pane scroll-thin'
    div.dataset.u32Name = 'side-pane-anno'
    div.dataset.pane = 'anno'
    div.hidden = true
    div.appendChild(this._annoList)
    return div
  })()

  readonly root: HTMLElement = (() => {
    const aside = document.createElement('aside')
    aside.className = 'sidebar'
    aside.dataset.u32Name = 'sidebar'

    const tabs = document.createElement('div')
    tabs.className = 'side-tabs'
    tabs.dataset.u32Name = 'side-tabs'
    tabs.appendChild(this._tabThumbs)
    tabs.appendChild(this._tabAnno)

    aside.appendChild(tabs)
    aside.appendChild(this._thumbsPane)
    aside.appendChild(this._annoPane)
    return aside
  })()

  private _tab: Tab = 'thumbs'
  private _renderedThumbs = new Set<HTMLElement>()

  private _thumbObs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const el = e.target as HTMLElement
        if (this._renderedThumbs.has(el)) continue
        this._renderedThumbs.add(el)
        void this._paintThumb(el)
      }
    },
    { root: this._thumbsPane, rootMargin: '400px 0px' },
  )

  private _initWatches = (() => {
    this.dispose(watch([this._opt.records.changed], () => this._renderList()))
    this.dispose(
      watch([this._opt.currentPage.changed], () => {
        const cur = this._opt.currentPage.value
        for (const el of Array.from(this._thumbs.children)) {
          const n = Number((el as HTMLElement).dataset.page)
          el.setAttribute('aria-current', String(n === cur))
        }
      }),
    )
    this.dispose(() => this._thumbObs.disconnect())
  })()

  /** 新文档：重建缩略图骨架 */
  buildThumbs(pdf: PDFDocumentProxy) {
    this._thumbObs.disconnect()
    this._renderedThumbs.clear()
    this._thumbs.replaceChildren()
    for (let i = 1; i <= pdf.numPages; i++) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'thumb'
      item.dataset.u32Name = `thumb-${i}`
      item.dataset.page = String(i)
      item.setAttribute('aria-current', 'false')
      item.title = `第 ${i} 页`

      const skel = document.createElement('span')
      skel.className = 'thumb-skel'
      // 真实高度在 _paintThumb 里随页面比例补齐，先用 Letter 比例占位
      skel.style.height = '166px'
      skel.dataset.u32Name = 'thumb-skeleton'

      const no = document.createElement('span')
      no.className = 'thumb-no'
      no.dataset.u32Name = 'thumb-no'
      no.textContent = String(i)

      item.appendChild(skel)
      item.appendChild(no)
      item.addEventListener('click', () => this._opt.onGoToPage(i))
      this._thumbs.appendChild(item)
      this._thumbObs.observe(item)
    }
    this._renderList()
    if (this._tab === 'thumbs') this._kickThumbs()
  }

  private async _paintThumb(item: HTMLElement) {
    const pdf = this._opt.pdf()
    const n = Number(item.dataset.page)
    if (!pdf || !n) return
    const page = await pdf.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale: (THUMB_W * dpr) / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.dataset.u32Name = `thumbnail-${n}`
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    const skel = item.querySelector('.thumb-skel')
    skel?.replaceWith(canvas)
  }

  private _kickThumbs() {
    const box = this._thumbsPane.getBoundingClientRect()
    for (const el of Array.from(this._thumbs.children) as HTMLElement[]) {
      if (this._renderedThumbs.has(el)) continue
      const r = el.getBoundingClientRect()
      if (r.bottom > box.top - 400 && r.top < box.bottom + 400) {
        this._renderedThumbs.add(el)
        void this._paintThumb(el)
      }
    }
  }

  private _setTab(tab: Tab) {
    this._tab = tab
    this._tabThumbs.setAttribute('aria-selected', String(tab === 'thumbs'))
    this._tabAnno.setAttribute('aria-selected', String(tab === 'anno'))
    this._thumbsPane.hidden = tab !== 'thumbs'
    this._annoPane.hidden = tab !== 'anno'
    if (tab === 'thumbs') this._kickThumbs()
  }

  private _renderList() {
    const list = [...this._opt.records.value].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
    this._annoList.replaceChildren()
    if (list.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'side-empty'
      empty.dataset.u32Name = 'anno-empty'
      empty.textContent = this._opt.pdf() ? '还没有批注。选中文字可高亮，或用工具栏放置便签、文字。' : '打开一份 PDF 后，批注会列在这里。'
      this._annoList.appendChild(empty)
      return
    }
    for (const rec of list) {
      const item = document.createElement('div')
      item.className = 'anno-item'
      item.dataset.u32Name = 'anno-item'
      item.dataset.type = rec.type
      item.dataset.id = rec.id
      item.tabIndex = 0

      const mark = document.createElement('span')
      mark.className = 'mark'
      mark.dataset.u32Name = 'anno-mark'

      const body = document.createElement('div')
      body.className = 'body'
      body.dataset.u32Name = 'anno-body'

      const txt = document.createElement('div')
      txt.className = 'txt'
      txt.dataset.u32Name = 'anno-text-preview'
      txt.textContent = previewOf(rec)

      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.dataset.u32Name = 'anno-meta'
      meta.textContent = `第 ${rec.page} 页 · ${TYPE_LABEL[rec.type] ?? rec.type}`

      body.appendChild(txt)
      body.appendChild(meta)

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'del'
      del.dataset.u32Name = 'anno-delete'
      del.title = '删除这条批注'
      del.innerHTML = icons.trash
      del.addEventListener('click', (e) => {
        e.stopPropagation()
        this._opt.onDeleteAnnotation(rec.id)
      })

      item.appendChild(mark)
      item.appendChild(body)
      item.appendChild(del)
      item.addEventListener('click', () => this._opt.onActivateAnnotation(rec))
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          this._opt.onActivateAnnotation(rec)
        }
      })
      this._annoList.appendChild(item)
    }
  }
}

function previewOf(rec: AnnotationRecord): string {
  if (rec.type === 'note' || rec.type === 'text') return rec.text || '（空）'
  return rec.text ? `“${rec.text}”` : `第 ${rec.page} 页的一段文字`
}
