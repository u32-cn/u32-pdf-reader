import { Destroyable, watch } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { ReactiveVariable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AnnotationRecord, BookmarkRecord } from './AnnotationStore'
import { icons } from './icons'

const THUMB_W = 128
const TYPE_LABEL: Record<string, string> = {
  highlight: '高亮',
  underline: '下划线',
  note: '便签',
  text: '文字',
  ink: '手绘',
  shape: '图形',
}

/** pdf.js 大纲节点（用到的字段） */
interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items?: OutlineNode[]
}

export interface SidebarOptions {
  pdf: () => PDFDocumentProxy | null
  records: ReactiveVariable<AnnotationRecord[]>
  bookmarks: ReactiveVariable<BookmarkRecord[]>
  currentPage: ReactiveVariable<number>
  onGoToPage: (n: number) => void
  onActivateAnnotation: (record: AnnotationRecord) => void
  onDeleteAnnotation: (id: string) => void
  onToggleBookmark: (page: number) => void
}

class SidebarBase extends Destroyable {
  constructor(protected _opt: SidebarOptions) {
    super()
  }
}

type Tab = 'thumbs' | 'outline' | 'bookmarks' | 'anno'

/**
 * 左侧栏：缩略图 / 目录 / 书签 / 批注四栏，缩略图按需渲染（滚到附近才画）。
 */
export class Sidebar extends SidebarBase {
  private readonly _tabThumbs = this._makeTab('thumbs', '缩略图')
  private readonly _tabOutline = this._makeTab('outline', '目录')
  private readonly _tabBookmarks = this._makeTab('bookmarks', '书签')
  private readonly _tabAnno = this._makeTab('anno', '批注')

  private _makeTab(tab: Tab, label: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'side-tab'
    btn.dataset.u32Name = `side-tab-${tab}`
    btn.dataset.tab = tab
    btn.textContent = label
    btn.setAttribute('aria-selected', 'false')
    btn.addEventListener('click', () => this._setTab(tab))
    return btn
  }

  private readonly _thumbs: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'thumbs'
    div.dataset.u32Name = 'thumbs'
    return div
  })()

  private readonly _outlineList: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'outline-list'
    div.dataset.u32Name = 'outline-list'
    return div
  })()

  private readonly _bookmarkList: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'bookmark-list'
    div.dataset.u32Name = 'bookmark-list'
    return div
  })()

  private readonly _annoList: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'anno-list'
    div.dataset.u32Name = 'anno-list'
    return div
  })()

  private _pane(label: string, child: HTMLElement): HTMLDivElement {
    const div = document.createElement('div')
    div.className = 'side-pane scroll-thin'
    div.dataset.u32Name = `side-pane-${label}`
    div.dataset.pane = label
    div.hidden = label !== 'thumbs'
    div.appendChild(child)
    return div
  }

  private readonly _thumbsPane = this._pane('thumbs', this._thumbs)
  private readonly _outlinePane = this._pane('outline', this._outlineList)
  private readonly _bookmarksPane = this._pane('bookmarks', this._bookmarkList)
  private readonly _annoPane = this._pane('anno', this._annoList)

  readonly root: HTMLElement = (() => {
    const aside = document.createElement('aside')
    aside.className = 'sidebar'
    aside.dataset.u32Name = 'sidebar'

    const tabs = document.createElement('div')
    tabs.className = 'side-tabs'
    tabs.dataset.u32Name = 'side-tabs'
    tabs.appendChild(this._tabThumbs)
    tabs.appendChild(this._tabOutline)
    tabs.appendChild(this._tabBookmarks)
    tabs.appendChild(this._tabAnno)

    aside.appendChild(tabs)
    aside.appendChild(this._thumbsPane)
    aside.appendChild(this._outlinePane)
    aside.appendChild(this._bookmarksPane)
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
    this.dispose(watch([this._opt.bookmarks.changed], () => this._renderBookmarks()))
    this.dispose(
      watch([this._opt.currentPage.changed], () => {
        const cur = this._opt.currentPage.value
        for (const el of Array.from(this._thumbs.children)) {
          const n = Number((el as HTMLElement).dataset.page)
          el.setAttribute('aria-current', String(n === cur))
        }
        if (this._tab === 'bookmarks') this._renderBookmarks()
      }),
    )
    this.dispose(() => this._thumbObs.disconnect())
  })()

  /** 新文档：重建缩略图骨架 + 读大纲 */
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
    this._renderBookmarks()
    void this._buildOutline(pdf)
    if (this._tab === 'thumbs') this._kickThumbs()
  }

  private async _buildOutline(pdf: PDFDocumentProxy) {
    this._outlineList.replaceChildren(this._sideEmpty('正在读取目录…', 'outline-loading'))
    let outline: OutlineNode[] | null = null
    try {
      outline = (await pdf.getOutline()) as OutlineNode[] | null
    } catch {
      outline = null
    }
    // 防止旧文档的异步结果覆盖新文档
    if (this._opt.pdf() !== pdf) return
    this._outlineList.replaceChildren()
    if (!outline || outline.length === 0) {
      this._outlineList.appendChild(this._sideEmpty('本文档没有自带目录。', 'outline-empty'))
      return
    }
    const frag = document.createDocumentFragment()
    for (const node of outline) frag.appendChild(this._outlineItem(node, 0))
    this._outlineList.appendChild(frag)
  }

  /** 递归构建大纲条目（缩进表达层级） */
  private _outlineItem(node: OutlineNode, depth: number): HTMLElement {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'outline-item'
    item.dataset.u32Name = 'outline-item'
    item.style.paddingLeft = `${8 + depth * 14}px`
    const title = document.createElement('span')
    title.className = 'outline-title'
    title.textContent = node.title || '（无标题）'
    item.appendChild(title)

    item.addEventListener('click', () => void this._gotoOutlineDest(node.dest))

    const frag = document.createDocumentFragment()
    for (const child of node.items ?? []) frag.appendChild(this._outlineItem(child, depth + 1))
    if (frag.childNodes.length > 0) {
      const wrap = document.createElement('div')
      wrap.appendChild(item)
      wrap.appendChild(frag)
      return wrap
    }
    return item
  }

  /** 大纲 dest → 页码跳转；字符串 dest（命名目标）需先解析 */
  private async _gotoOutlineDest(dest: string | unknown[] | null) {
    const pdf = this._opt.pdf()
    if (!pdf || dest == null) return
    try {
      let explicit: unknown[] | null = null
      if (typeof dest === 'string') {
        const resolved = await pdf.getDestination(dest)
        explicit = Array.isArray(resolved) ? (resolved as unknown[]) : null
      } else if (Array.isArray(dest)) {
        explicit = dest
      }
      if (!explicit || explicit.length === 0) return
      const ref = explicit[0]
      // dest[0] 可能是页对象或页号
      let pageNum: number | null = null
      if (typeof ref === 'object' && ref !== null && 'num' in ref) {
        const index = await pdf.getPageIndex(ref as { num: number } as never)
        pageNum = index + 1
      } else if (typeof ref === 'number') {
        pageNum = ref + 1
      }
      if (pageNum) this._opt.onGoToPage(pageNum)
    } catch {
      /* 跳不动就当没点 */
    }
  }

  private _sideEmpty(text: string, name: string): HTMLDivElement {
    const div = document.createElement('div')
    div.className = 'side-empty'
    div.dataset.u32Name = name
    div.textContent = text
    return div
  }

  private _renderBookmarks() {
    const list = this._opt.bookmarks.value
    this._bookmarkList.replaceChildren()
    if (list.length === 0) {
      this._bookmarkList.appendChild(
        this._sideEmpty(
          this._opt.pdf()
            ? '还没有书签。用工具栏的书签按钮给当前页加一个。'
            : '打开一份 PDF 后，书签会列在这里。',
          'bookmark-empty',
        ),
      )
      return
    }
    const cur = this._opt.currentPage.value
    for (const bm of list) {
      const item = document.createElement('div')
      item.className = 'bookmark-item'
      item.dataset.u32Name = 'bookmark-item'
      item.dataset.page = String(bm.page)
      item.tabIndex = 0
      if (bm.page === cur) item.setAttribute('aria-current', 'true')

      const icon = document.createElement('span')
      icon.className = 'mark'
      icon.innerHTML = icons.bookmark

      const body = document.createElement('div')
      body.className = 'body'
      const txt = document.createElement('div')
      txt.className = 'txt'
      txt.textContent = bm.title || `第 ${bm.page} 页`
      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = `第 ${bm.page} 页`
      body.appendChild(txt)
      body.appendChild(meta)

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'del'
      del.dataset.u32Name = 'bookmark-delete'
      del.title = '删除这个书签'
      del.innerHTML = icons.trash
      del.addEventListener('click', (e) => {
        e.stopPropagation()
        this._opt.onToggleBookmark(bm.page)
      })

      item.appendChild(icon)
      item.appendChild(body)
      item.appendChild(del)
      item.addEventListener('click', () => this._opt.onGoToPage(bm.page))
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          this._opt.onGoToPage(bm.page)
        }
      })
      this._bookmarkList.appendChild(item)
    }
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
    for (const [t, btn] of [
      ['thumbs', this._tabThumbs],
      ['outline', this._tabOutline],
      ['bookmarks', this._tabBookmarks],
      ['anno', this._tabAnno],
    ] as const) {
      btn.setAttribute('aria-selected', String(t === tab))
    }
    this._thumbsPane.hidden = tab !== 'thumbs'
    this._outlinePane.hidden = tab !== 'outline'
    this._bookmarksPane.hidden = tab !== 'bookmarks'
    this._annoPane.hidden = tab !== 'anno'
    if (tab === 'thumbs') this._kickThumbs()
    if (tab === 'bookmarks') this._renderBookmarks()
  }

  private _renderList() {
    const list = [...this._opt.records.value].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
    this._annoList.replaceChildren()
    if (list.length === 0) {
      this._annoList.appendChild(
        this._sideEmpty(
          this._opt.pdf()
            ? '还没有批注。选中文字可高亮，或用工具栏放置便签、文字。'
            : '打开一份 PDF 后，批注会列在这里。',
          'anno-empty',
        ),
      )
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
