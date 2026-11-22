import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Destroyable, react, watch } from '@vtxfp/vtxf-basic-tools-202607/browser'
import './styles/app.css'
import { AnnotationStore, createAnnotationId, DEFAULT_ANNO_STYLE, type AnnotationRecord, type AnnotationStyle, type ShapeKind } from './AnnotationStore'
import { collectEmbeddedAudios, hasSoundAnnotations, type EmbeddedAudio, type SoundAnnotRef } from './audioExtract'
import { AudioPlayer } from './AudioPlayer'
import { EmptyState } from './EmptyState'
import { NotePopover } from './NotePopover'
import { SelectionToolbar } from './SelectionToolbar'
import { ShapeToolbar } from './ShapeToolbar'
import { Sidebar } from './Sidebar'
import { TopBar, type ToolMode } from './TopBar'
import { Viewer } from './Viewer'
import type { PageView } from './PageView'
import './pdf-worker'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

/** 绘制类工具（拖拽/移动出线的） */
type DrawTool = Extract<ToolMode, 'ink' | 'shape'>

/** 批注显示开关偏好（跨会话记忆） */
const PREF_KEY = 'u32pdf.anno-visibility'

function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return fallback
    const obj = JSON.parse(raw) as Record<string, unknown>
    return typeof obj[key] === 'boolean' ? (obj[key] as boolean) : fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: boolean) {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    obj[key] = value
    localStorage.setItem(PREF_KEY, JSON.stringify(obj))
  } catch {
    /* 存不了就算了，偏好不关键 */
  }
}

/**
 * 应用装配与状态编排：只负责「打开文档 / 工具切换 / 批注增删 / 键盘与拖拽」，
 * 页面绘制在 Viewer/PageView，视觉在 TopBar/Sidebar，批注状态在 AnnotationStore。
 */
export class PdfReaderApp extends Destroyable {
  private _store = this.disposeVar(new AnnotationStore())
  private _pdf: PDFDocumentProxy | null = null

  private _selectionTick = 0

  private _fileName = this.disposeVar(react(''))
  private _tool = this.disposeVar(react<ToolMode>('select'))
  private _annoCount = this.disposeVar(react(0))

  /** 窗口标题常量 */
  private static readonly APP_TITLE = 'U32 PDF 阅读器'

  /** 绘制工具状态（顶栏选项条读写，落库时套用） */
  private _drawColor = this.disposeVar(react<string>(DEFAULT_ANNO_STYLE.color))
  private _strokeWidth = this.disposeVar(react<number>(DEFAULT_ANNO_STYLE.strokeWidth))
  private _shapeKind = this.disposeVar(react<ShapeKind>('rect'))

  /** 批注显示开关（跨会话记忆偏好）：pdf=PDF原生外观（图钉/喇叭），chip=衍生播放按钮，mine=手动批注 */
  private _annoPdfHidden = this.disposeVar(react(readPref('annoPdfHidden', false)))
  private _annoChipHidden = this.disposeVar(react(readPref('annoChipHidden', false)))
  private _annoMineHidden = this.disposeVar(react(readPref('annoMineHidden', false)))

  /** 进行中的绘制预览（overlay 放在对应页面的批注层里） */
  private _drawing: {
    tool: DrawTool
    pageView: PageView
    points: [number, number, number, number][]
    overlay: SVGSVGElement
    el: SVGElement
  } | null = null

  /** 新建文字/便签过程中样式条攒下的样式，保存时随记录落库 */
  private _pendingStyle: AnnotationStyle = {}

  /** 当前选中的手动批注（便签/文字/手绘/图形）：选中态 + Delete 删除 */
  private _selectedAnnoId: string | null = null

  private _viewer = new Viewer({
    store: this._store,
    onAudioChip: (audio, chip) => this._player.open(audio, chip),
    onAnnotationActivate: (record, _ev, pageView) => this._activateAnnotation(record, pageView),
    onRebuilt: () => {
      this.reanchorPlayer()
      this._notePop.close()
    },
  })

  private _topbar = new TopBar({
    totalPages: this._viewer.totalPages,
    currentPage: this._viewer.currentPage,
    zoom: this._viewer.zoom,
    tool: this._tool,
    annoCount: this._annoCount,
    drawColor: this._drawColor,
    strokeWidth: this._strokeWidth,
    shapeKind: this._shapeKind,
    onOpen: () => void this.openFile(),
    onToolChange: (tool) => this.setTool(tool),
    onGoToPage: (page) => this.goToPage(page),
    onZoomIn: () => this._viewer.zoomIn(),
    onZoomOut: () => this._viewer.zoomOut(),
    onFitWidth: () => this._viewer.fitWidth(),
    onToggleSidebar: () => this.toggleSidebar(),
    annoPdfHidden: this._annoPdfHidden,
    annoChipHidden: this._annoChipHidden,
    annoMineHidden: this._annoMineHidden,
    onToggleAnnoPdf: () => this.toggleAnnoVisibility('pdf'),
    onToggleAnnoChip: () => this.toggleAnnoVisibility('chip'),
    onToggleAnnoMine: () => this.toggleAnnoVisibility('mine'),
    canUndo: () => this._store.canUndo,
    canRedo: () => this._store.canRedo,
    historyChanged: this._store.historyChanged,
    onUndo: () => this._store.undo(),
    onRedo: () => this._store.redo(),
    hasBookmark: () => this._store.hasBookmark(this._viewer.currentPage.value) !== undefined,
    bookmarksChanged: this._store.bookmarksReactive,
    onToggleBookmark: () => this._store.toggleBookmark(this._viewer.currentPage.value),
  })

  private _sidebar = new Sidebar({
    pdf: () => this._pdf,
    records: this._store.recordsVar,
    bookmarks: this._store.bookmarksVar,
    currentPage: this._viewer.currentPage,
    onGoToPage: (page) => this.goToPage(page),
    onActivateAnnotation: (record) => this._activateFromList(record),
    onDeleteAnnotation: (id) => this.deleteAnnotation(id),
    onToggleBookmark: (page) => this._store.toggleBookmark(page),
  })

  private _player = new AudioPlayer({})
  private _notePop = new NotePopover()
  private _shapeTb = new ShapeToolbar({
    onColor: (color) => this._updateSelectedStyle({ color }),
    onWidth: (width) => this._updateSelectedStyle({ strokeWidth: width }),
    onDelete: () => {
      if (this._selectedAnnoId) this.deleteAnnotation(this._selectedAnnoId)
    },
  })
  private _selToolbar = new SelectionToolbar({ onPick: (type) => this.applySelection(type) })
  private _empty = new EmptyState({ onOpen: () => void this.openFile() })

  /** E2E 测试钩子（生产无副作用） */
  readonly testHooks = {
    openPath: (path: string) => this.openPath(path),
  }

  readonly root: HTMLElement = document.getElementById('app')!

  private _veil: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'drop-veil'
    div.dataset.u32Name = 'drop-veil'
    div.textContent = '松开以打开这份 PDF'
    return div
  })()

  private _body: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'app-body'
    div.dataset.u32Name = 'app-body'
    div.appendChild(this._sidebar.root)
    div.appendChild(this._viewer.root)
    return div
  })()

  private _mount = (() => {
    const root = this.root
    root.classList.add('u32pdf')
    root.dataset.u32Name = 'app'
    root.dataset.tool = 'select'
    root.dataset.sidebar = 'open'
    root.dataset.dragover = 'false'
    root.dataset.annoPdfHidden = String(this._annoPdfHidden.value)
    root.dataset.annoChipHidden = String(this._annoChipHidden.value)
    root.dataset.annoMineHidden = String(this._annoMineHidden.value)

    this._viewer.root.appendChild(this._empty.root)
    this._viewer.root.appendChild(this._veil)
    this._empty.setVisible(true)

    root.appendChild(this._topbar.root)
    root.appendChild(this._body)
    return true
  })()

  private _init = (() => {
    this.dispose(watch([this._store.recordsChanged], () => {
      this._annoCount.value = this._store.records.length
      this._viewer.repaintAnnotations()
    }))

    const onSelectionChange = () => {
      if (this._selectionTick) return
      this._selectionTick = requestAnimationFrame(() => {
        this._selectionTick = 0
        this.syncSelectionToolbar()
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    this.dispose(() => document.removeEventListener('selectionchange', onSelectionChange))

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (!target.closest('.sel-toolbar')) this._selToolbar.hide()
      if (!target.closest('.note-pop') && !target.closest('.anno-note') && !target.closest('.anno-text')) {
        this._notePop.close()
      }
      // 点空白处清除手动批注选中态（点在批注/弹窗/播放条/图形工具条上则保留）
      if (
        this._selectedAnnoId &&
        !target.closest('.anno-note, .anno-text, .anno-svg, .note-pop, .pop-player, .shape-tb')
      ) {
        this._clearSelectedAnno()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    this.dispose(() => document.removeEventListener('mousedown', onDocMouseDown))

    const onViewerMouseDown = (e: MouseEvent) => {
      const tool = this._tool.value
      if (tool !== 'note' && tool !== 'text') return
      if ((e.target as HTMLElement).closest('.note-pop, .pop-player, .audio-chip')) return
      e.preventDefault()
    }
    this._viewer.root.addEventListener('mousedown', onViewerMouseDown)
    this.dispose(() => this._viewer.root.removeEventListener('mousedown', onViewerMouseDown))

    // 绘制类工具：mousedown 起笔 → mousemove 预览 → mouseup 落库
    const onDrawStart = (e: MouseEvent) => {
      if (e.button !== 0) return
      const tool = this._tool.value
      if (tool !== 'ink' && tool !== 'shape') return
      if ((e.target as HTMLElement).closest('.note-pop, .pop-player, .audio-chip, .sel-toolbar')) return
      const pageView = this._pageViewFromNode(e.target as Node)
      if (!pageView) return
      e.preventDefault()
      this._beginDraw(tool, pageView, e)
    }
    this._viewer.root.addEventListener('mousedown', onDrawStart)
    this.dispose(() => this._viewer.root.removeEventListener('mousedown', onDrawStart))

    const onDrawMove = (e: MouseEvent) => {
      if (!this._drawing) return
      this._extendDraw(e)
    }
    window.addEventListener('mousemove', onDrawMove)
    this.dispose(() => window.removeEventListener('mousemove', onDrawMove))

    const onDrawEnd = (e: MouseEvent) => {
      if (!this._drawing) return
      this._endDraw(e)
    }
    window.addEventListener('mouseup', onDrawEnd)
    this.dispose(() => window.removeEventListener('mouseup', onDrawEnd))

    const onViewerMouseUp = (e: MouseEvent) => {
      const tool = this._tool.value
      if (tool !== 'highlight' && tool !== 'underline') return
      const pageView = this._pageViewFromNode(e.target as Node)
      if (!pageView) return
      const record = pageView.annotationLayer.recordFromSelection(tool)
      if (record) {
        this._store.add(record)
        this._selToolbar.hide()
      }
    }
    this._viewer.root.addEventListener('mouseup', onViewerMouseUp)
    this.dispose(() => this._viewer.root.removeEventListener('mouseup', onViewerMouseUp))

    const onClick = (e: MouseEvent) => {
      const tool = this._tool.value
      if (tool !== 'note' && tool !== 'text') return
      const target = e.target as HTMLElement
      if (target.closest('.note-pop, .pop-player, .audio-chip, .anno-note, .anno-text')) return
      const pageView = this._pageViewFromNode(target)
      if (!pageView) return
      this._beginPlacement(tool, pageView, e)
    }
    this._viewer.root.addEventListener('click', onClick)
    this.dispose(() => this._viewer.root.removeEventListener('click', onClick))

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      if (e.deltaY < 0) this._viewer.zoomIn()
      else this._viewer.zoomOut()
    }
    this._viewer.root.addEventListener('wheel', onWheel, { passive: false })
    this.dispose(() => this._viewer.root.removeEventListener('wheel', onWheel))

    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e)
    window.addEventListener('keydown', onKeyDown)
    this.dispose(() => window.removeEventListener('keydown', onKeyDown))

    // main 进程转来的打开请求：双击关联文件 / 第二实例
    window.bridge.onOpenPdfPath((p) => void this.openPath(p))

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      this.root.dataset.dragover = 'true'
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget) return
      this.root.dataset.dragover = 'false'
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      this.root.dataset.dragover = 'false'
      const file = e.dataTransfer?.files?.[0]
      if (!file || !/\.pdf$/i.test(file.name)) return
      const path = window.bridge.getPathForFile(file)
      if (path) void this.openPath(path)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    this.dispose(() => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    })
    return true
  })()

  /** 缩放/改宽会重建页面 DOM，播放条要迁移到新页面的同一个图标上（音频不中断） */
  private reanchorPlayer() {
    const audio = this._player.current.value
    if (!this._player.isOpen || !audio) return
    const pageView = this._viewer.pages[audio.pageNum - 1]
    const index = this._viewer.audiosOf(audio.pageNum).indexOf(audio)
    const chip = index >= 0 ? pageView?.chips[index] : undefined
    if (chip) this._player.open(audio, chip)
    else this._player.close()
  }

  /** 打开系统文件选择框 */
  async openFile() {
    const path = await window.bridge.openPdfDialog()
    if (path) await this.openPath(path)
  }

  async openPath(path: string) {
    this.setTool('select')
    this._notePop.close()
    this._player.close()

    const buf = await window.bridge.readPdf(path)
    const scan = new Uint8Array(buf.slice(0))
    const doc = await pdfjsLib.getDocument({ data: buf }).promise
    this._pdf = doc

    await this._store.load(path)
    const name = path.split(/[\\/]/).pop() || ''
    this._fileName.value = name
    void window.bridge.setWindowTitle(`${name} - ${PdfReaderApp.APP_TITLE}`)
    this._annoCount.value = this._store.records.length

    const audios = await this.collectAudios(doc, scan)

    this._empty.setVisible(false)
    this._viewer.setPdfAnnotationMode(this._annoPdfHidden.value ? 0 : 1)
    await this._viewer.setDocument(doc, audios)
    this._sidebar.buildThumbs(doc)
  }

  /** 音频提取：页码与矩形由 pdf.js 注解表精确给出，再回原始字节取流 */
  private async collectAudios(doc: PDFDocumentProxy, scan: Uint8Array): Promise<EmbeddedAudio[]> {
    if (!hasSoundAnnotations(scan)) return []
    const refs = new Map<number, SoundAnnotRef>()
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const list = await page.getAnnotations()
      for (const a of list) {
        const st = String(a.subtype)
        if (st !== 'Sound' && st !== 'FileAttachment') continue
        const m = /^(\d+)/.exec(String(a.id ?? ''))
        if (!m) continue
        refs.set(Number(m[1]), {
          pageNum: i,
          rect: a.rect as [number, number, number, number],
        })
      }
    }
    if (refs.size === 0) return []
    return collectEmbeddedAudios(scan, refs)
  }

  setTool(tool: ToolMode) {
    this._tool.value = tool
    this.root.dataset.tool = tool
    if (tool !== 'select') this._selToolbar.hide()
    if (tool === 'note' || tool === 'text' || tool === 'ink' || tool === 'shape') {
      // 放置/绘制类工具需要干净页面：清选区、收起播放条
      window.getSelection()?.removeAllRanges()
      this._player.close()
    }
  }

  goToPage(page: number) {
    const total = this._viewer.totalPages.value
    if (total === 0) return
    this._viewer.scrollToPage(Math.min(Math.max(Math.round(page), 1), total))
  }

  toggleSidebar() {
    const open = this.root.dataset.sidebar !== 'closed'
    this.root.dataset.sidebar = open ? 'closed' : 'open'
    this._topbar.root
      .querySelector('[data-u32-name="topbar-sidebar"]')
      ?.setAttribute('aria-expanded', String(!open))
  }

  /** 批注显示开关：写 root.dataset 驱动 CSS，偏好落 localStorage */
  toggleAnnoVisibility(group: 'pdf' | 'chip' | 'mine') {
    const v = group === 'pdf' ? this._annoPdfHidden : group === 'chip' ? this._annoChipHidden : this._annoMineHidden
    const key = group === 'pdf' ? 'annoPdfHidden' : group === 'chip' ? 'annoChipHidden' : 'annoMineHidden'
    v.value = !v.value
    this.root.dataset[key] = String(v.value)
    writePref(key, v.value)
    // PDF 组还要控制 canvas 里的注解外观（附件图钉、Sound 喇叭是 pdf.js 画的像素，CSS 管不到）
    if (group === 'pdf') {
      this._viewer.setPdfAnnotationMode(v.value ? 0 : 1)
    } else if (group === 'mine' && v.value) {
      // 隐藏手动批注时收掉选中态与工具条
      this._clearSelectedAnno()
      this._notePop.close()
    }
  }

  /** 用当前选区直接打高亮/下划线（浮条与 H/U 快捷键共用） */
  applySelection(type: 'highlight' | 'underline') {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const pageView = this._pageViewFromNode(sel.anchorNode)
    if (!pageView) return
    const record = pageView.annotationLayer.recordFromSelection(type)
    if (record) this._store.add(record)
    this._selToolbar.hide()
  }

  deleteAnnotation(id: string) {
    this._notePop.close()
    this._clearSelectedAnno()
    this._store.remove(id)
  }

  /** 手动批注选中态：给对应 DOM 加 class，换选/关闭时清掉 */
  private _setSelectedAnno(id: string) {
    if (this._selectedAnnoId === id) return
    this._clearSelectedAnno()
    this._selectedAnnoId = id
    const el = this._viewer.root.querySelector(`[data-id="${CSS.escape(id)}"]`)
    el?.classList.add('anno-selected')
  }

  private _clearSelectedAnno() {
    if (!this._selectedAnnoId) return
    const el = this._viewer.root.querySelector(`[data-id="${CSS.escape(this._selectedAnnoId)}"]`)
    el?.classList.remove('anno-selected')
    this._selectedAnnoId = null
    this._shapeTb.close()
  }

  /** 当前工具对应的批注样式 */
  private _currentDrawStyle(): AnnotationStyle {
    return { color: this._drawColor.value, strokeWidth: this._strokeWidth.value }
  }

  /** 起笔：在目标页批注层挂一个预览 SVG */
  private _beginDraw(tool: DrawTool, pageView: PageView, ev: MouseEvent) {
    const [x, y] = pageView.annotationLayer.pointOf(ev)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('anno-svg')
    svg.setAttribute('viewBox', '0 0 1000 1000')
    svg.setAttribute('preserveAspectRatio', 'none')
    const points: [number, number, number, number][] =
      tool === 'shape' ? [[x, y, x, y]] : [[x, y, 0, 0]]
    const el = this._drawElement(svg, tool, points, this._currentDrawStyle())
    svg.appendChild(el)
    pageView.annotationLayer.root.appendChild(svg)
    this._drawing = { tool, pageView, points, overlay: svg, el }
  }

  /** 预览：追加点 / 更新对角点并重画 */
  private _extendDraw(ev: MouseEvent) {
    const d = this._drawing
    if (!d) return
    const [x, y] = d.pageView.annotationLayer.pointOf(ev)
    if (d.tool === 'shape') {
      d.points[0] = [d.points[0][0], d.points[0][1], x, y]
    } else {
      // 采样：距上一点足够远才记录，避免点爆炸
      const last = d.points[d.points.length - 1]
      if (Math.hypot(x - last[0], y - last[1]) > 0.004) d.points.push([x, y, 0, 0])
    }
    const next = this._drawElement(d.overlay, d.tool, d.points, this._currentDrawStyle())
    d.el.replaceWith(next)
    d.el = next
  }

  /** 收笔：有效笔画入库，无效（单击/近零位移）丢弃 */
  private _endDraw(ev: MouseEvent) {
    const d = this._drawing
    this._drawing = null
    if (!d) return
    const [x, y] = d.pageView.annotationLayer.pointOf(ev)
    let rects = d.points
    if (d.tool === 'shape') rects = [[d.points[0][0], d.points[0][1], x, y]]

    const span = this._spanOf(rects)
    const minLen = d.tool === 'shape' ? 0.008 : 0.004
    if (span < minLen) {
      d.overlay.remove()
      return
    }

    this._store.add({
      id: createAnnotationId(),
      type: d.tool,
      page: d.pageView.pageNum,
      rects,
      shape: d.tool === 'shape' ? this._shapeKind.value : undefined,
      style: this._currentDrawStyle(),
      createdAt: Date.now(),
    })
    // 记录入库触发 repaint 会整体重画，预览 overlay 随 replaceChildren 一并消失
    d.overlay.remove()
    this.setTool('select')
  }

  /** 笔画几何跨度（判定是否有效） */
  private _spanOf(rects: [number, number, number, number][]): number {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x0, y0, x1, y1] of rects) {
      minX = Math.min(minX, x0, x1)
      minY = Math.min(minY, y0, y1)
      maxX = Math.max(maxX, x0, x1)
      maxY = Math.max(maxY, y0, y1)
    }
    return Math.hypot(maxX - minX, maxY - minY)
  }

  /** 生成预览用 SVG 元素（与 AnnotationLayer 渲染规则一致） */
  private _drawElement(
    svg: SVGSVGElement,
    tool: DrawTool,
    points: [number, number, number, number][],
    style: AnnotationStyle,
  ): SVGElement {
    const NS = 'http://www.w3.org/2000/svg'
    const color = style.color ?? DEFAULT_ANNO_STYLE.color
    const sw = String(Math.max(style.strokeWidth ?? DEFAULT_ANNO_STYLE.strokeWidth, 1))
    if (tool === 'ink') {
      const poly = document.createElementNS(NS, 'polyline')
      poly.setAttribute('points', points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' '))
      poly.setAttribute('fill', 'none')
      poly.setAttribute('stroke', color)
      poly.setAttribute('stroke-width', sw)
      poly.setAttribute('stroke-linecap', 'round')
      poly.setAttribute('stroke-linejoin', 'round')
      return poly
    }
    const [x0, y0, x1, y1] = points[0] ?? [0, 0, 0, 0]
    const ax = x0 * 1000
    const ay = y0 * 1000
    const bx = x1 * 1000
    const by = y1 * 1000
    const kind = this._shapeKind.value
    let el: SVGElement
    switch (kind) {
      case 'ellipse': {
        el = document.createElementNS(NS, 'ellipse')
        el.setAttribute('cx', String((ax + bx) / 2))
        el.setAttribute('cy', String((ay + by) / 2))
        el.setAttribute('rx', String(Math.abs(bx - ax) / 2))
        el.setAttribute('ry', String(Math.abs(by - ay) / 2))
        break
      }
      case 'line': {
        el = document.createElementNS(NS, 'line')
        el.setAttribute('x1', String(ax))
        el.setAttribute('y1', String(ay))
        el.setAttribute('x2', String(bx))
        el.setAttribute('y2', String(by))
        break
      }
      case 'arrow': {
        const dx = bx - ax
        const dy = by - ay
        const len = Math.hypot(dx, dy) || 1
        const head = Math.max(Math.min(len * 0.16, 60), 12)
        const ux = dx / len
        const uy = dy / len
        el = document.createElementNS(NS, 'path')
        el.setAttribute(
          'd',
          `M${ax},${ay}L${bx},${by}` +
            `M${bx - head * ux + head * 0.45 * uy},${by - head * uy - head * 0.45 * ux}` +
            `L${bx},${by}` +
            `L${bx - head * ux - head * 0.45 * uy},${by - head * uy + head * 0.45 * ux}`,
        )
        break
      }
      default: {
        el = document.createElementNS(NS, 'rect')
        el.setAttribute('x', String(Math.min(ax, bx)))
        el.setAttribute('y', String(Math.min(ay, by)))
        el.setAttribute('width', String(Math.abs(bx - ax)))
        el.setAttribute('height', String(Math.abs(by - ay)))
      }
    }
    el.setAttribute('fill', 'none')
    el.setAttribute('stroke', color)
    el.setAttribute('stroke-width', sw)
    el.setAttribute('stroke-linecap', 'round')
    el.setAttribute('stroke-linejoin', 'round')
    return el
  }

  private _beginPlacement(tool: 'note' | 'text', pageView: PageView, ev: MouseEvent) {
    const [x, y] = pageView.annotationLayer.pointOf(ev)
    const box = pageView.annotationLayer.root.getBoundingClientRect()
    this._notePop.open(pageView.root, {
      kind: tool,
      initial: '',
      left: ev.clientX - box.left,
      top: ev.clientY - box.top,
      onStyle: (style) => {
        // 新建中的实时样式先攒着，保存时随记录落库
        this._pendingStyle = style
      },
      onSave: (text) => {
        if (text) {
          this._store.add({
            id: createAnnotationId(),
            type: tool,
            page: pageView.pageNum,
            rects: [[x, y, x, y]],
            text,
            style: { ...this._pendingStyle },
            createdAt: Date.now(),
          })
        }
        this._pendingStyle = {}
        // 便签允许连放；文字放完自动回指针，避免误点出一堆空框
        if (tool === 'text') this.setTool('select')
      },
    })
  }

  private _activateAnnotation(record: AnnotationRecord, pageView: PageView) {
    this._setSelectedAnno(record.id)
    if (record.type === 'note' || record.type === 'text') {
      const [x, y] = record.rects[0] ?? [0, 0, 0, 0]
      const width = pageView.root.clientWidth
      const height = pageView.root.clientHeight
      this._pendingStyle = { ...record.style }
      this._shapeTb.close()
      this._notePop.open(pageView.root, {
        kind: record.type,
        initial: record.text ?? '',
        left: x * width + 14,
        top: y * height + 14,
        editing: true,
        style: record.style,
        onStyle: (style) => {
          this._pendingStyle = style
          this._store.updateStyle(record.id, style)
        },
        onSave: (text) => {
          this._store.setText(record.id, text)
          this._store.updateStyle(record.id, this._pendingStyle)
          this._pendingStyle = {}
        },
        onDelete: () => this._store.remove(record.id),
      })
      return
    }
    if (record.type === 'ink' || record.type === 'shape') {
      // 选中手绘/图形：弹就地工具条（换色/线宽/删除），不再静默套用画笔样式
      this._notePop.close()
      const style = record.style ?? {}
      this._shapeTb.sync(style.color ?? DEFAULT_ANNO_STYLE.color, style.strokeWidth ?? DEFAULT_ANNO_STYLE.strokeWidth)
      const box = this._annoBoxOf(record)
      this._shapeTb.open(pageView.root, box)
    }
  }

  /** 手绘/图形的归一化包围盒（工具条锚点用） */
  private _annoBoxOf(record: AnnotationRecord): { left: number; top: number; right: number; bottom: number } {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const r of record.rects) {
      // 手绘线的点格式是 [x, y, 0, 0]（后两位恒 0 占位），只取前两位；
      // shape 是 [x0, y0, x1, y1] 对角点，取全部四位
      const xs = record.type === 'ink' ? [r[0]] : [r[0], r[2]]
      const ys = record.type === 'ink' ? [r[1]] : [r[1], r[3]]
      for (const x of xs) minX = Math.min(minX, x), maxX = Math.max(maxX, x)
      for (const y of ys) minY = Math.min(minY, y), maxY = Math.max(maxY, y)
    }
    return { left: minX, top: minY, right: maxX, bottom: maxY }
  }

  /** 工具条改选中图形的样式（部分字段，落库全量 style） */
  private _updateSelectedStyle(patch: Partial<AnnotationStyle>) {
    const id = this._selectedAnnoId
    if (!id) return
    const record = this._store.records.find((r) => r.id === id)
    if (!record) return
    this._store.updateStyle(id, { ...record.style, ...patch })
    // 工具条回显新值
    const cur = record.style ?? {}
    this._shapeTb.sync(
      patch.color ?? cur.color ?? DEFAULT_ANNO_STYLE.color,
      patch.strokeWidth ?? cur.strokeWidth ?? DEFAULT_ANNO_STYLE.strokeWidth,
    )
  }

  private _activateFromList(record: AnnotationRecord) {
    this.goToPage(record.page)
    const pageView = this._viewer.pages[record.page - 1]
    if (!pageView) return
    if (record.type === 'note' || record.type === 'text') this._activateAnnotation(record, pageView)
  }

  private _pageViewFromNode(node: Node | null): PageView | null {
    if (!node) return null
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
    const shell = el?.closest('.page-shell') as HTMLElement | null
    if (!shell) return null
    const n = Number(shell.dataset.page)
    return this._viewer.pages[n - 1] ?? null
  }

  private syncSelectionToolbar() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      this._selToolbar.hide()
      return
    }
    const range = sel.getRangeAt(0)
    if (!this._pageViewFromNode(range.commonAncestorContainer)) {
      this._selToolbar.hide()
      return
    }
    const rect = range.getBoundingClientRect()
    if (rect.width < 1 && rect.height < 1) {
      this._selToolbar.hide()
      return
    }
    this._selToolbar.show(rect)
  }

  private handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    const typing =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'o':
        case 'O':
          e.preventDefault()
          void this.openFile()
          return
        case 'z':
        case 'Z':
          e.preventDefault()
          if (e.shiftKey) this._store.redo()
          else this._store.undo()
          return
        case 'y':
        case 'Y':
          e.preventDefault()
          this._store.redo()
          return
        case '=':
        case '+':
          e.preventDefault()
          this._viewer.zoomIn()
          return
        case '-':
          e.preventDefault()
          this._viewer.zoomOut()
          return
        case '0':
          e.preventDefault()
          this._viewer.fitWidth()
          return
        default:
          return
      }
    }

    if (e.key === 'Escape') {
      if (this._drawing) {
        this._drawing.overlay.remove()
        this._drawing = null
        return
      }
      if (this._notePop.isOpen) {
        this._notePop.close()
        this._clearSelectedAnno()
        return
      }
      if (this._shapeTb.isOpen) {
        this._shapeTb.close()
        this._clearSelectedAnno()
        return
      }
      if (this._player.isOpen) {
        this._player.close()
        return
      }
      if (this._selToolbar.isOpen) {
        this._selToolbar.hide()
        return
      }
      if (this._tool.value !== 'select') this.setTool('select')
      return
    }

    if (typing) return

    // Delete/Backspace 删除选中的手动批注
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedAnnoId) {
      e.preventDefault()
      this.deleteAnnotation(this._selectedAnnoId)
      return
    }

    switch (e.key.toLowerCase()) {
      case 'h':
        this.setTool('highlight')
        break
      case 'u':
        this.setTool('underline')
        break
      case 'n':
        this.setTool('note')
        break
      case 't':
        this.setTool('text')
        break
      case 'i':
        this.setTool('ink')
        break
      case 'g':
        this.setTool('shape')
        break
      case 'v':
        this.setTool('select')
        break
      case 'arrowleft':
        this.goToPage(this._viewer.currentPage.value - 1)
        break
      case 'arrowright':
        this.goToPage(this._viewer.currentPage.value + 1)
        break
      default:
        return
    }
    e.preventDefault()
  }
}

const app = new PdfReaderApp()
;(window as unknown as { __app: PdfReaderApp }).__app = app
