import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Destroyable, react, watch } from '@vtxfp/vtxf-basic-tools-202607/browser'
import './styles/app.css'
import { AnnotationStore, createAnnotationId, type AnnotationRecord } from './AnnotationStore'
import { collectEmbeddedAudios, hasSoundAnnotations, type EmbeddedAudio, type SoundAnnotRef } from './audioExtract'
import { AudioPlayer } from './AudioPlayer'
import { EmptyState } from './EmptyState'
import { NotePopover } from './NotePopover'
import { SelectionToolbar } from './SelectionToolbar'
import { Sidebar } from './Sidebar'
import { TopBar, type ToolMode } from './TopBar'
import { Viewer } from './Viewer'
import type { PageView } from './PageView'
import './pdf-worker'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

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
    fileName: this._fileName,
    totalPages: this._viewer.totalPages,
    currentPage: this._viewer.currentPage,
    zoom: this._viewer.zoom,
    tool: this._tool,
    annoCount: this._annoCount,
    onOpen: () => void this.openFile(),
    onToolChange: (tool) => this.setTool(tool),
    onGoToPage: (page) => this.goToPage(page),
    onZoomIn: () => this._viewer.zoomIn(),
    onZoomOut: () => this._viewer.zoomOut(),
    onFitWidth: () => this._viewer.fitWidth(),
    onToggleSidebar: () => this.toggleSidebar(),
  })

  private _sidebar = new Sidebar({
    pdf: () => this._pdf,
    records: this._store.recordsVar,
    currentPage: this._viewer.currentPage,
    onGoToPage: (page) => this.goToPage(page),
    onActivateAnnotation: (record) => this._activateFromList(record),
    onDeleteAnnotation: (id) => this.deleteAnnotation(id),
  })

  private _player = new AudioPlayer({})
  private _notePop = new NotePopover()
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
    this._fileName.value = path.split(/[\\/]/).pop() || ''
    this._annoCount.value = this._store.records.length

    const audios = await this.collectAudios(doc, scan)

    this._empty.setVisible(false)
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
        if (String(a.subtype) !== 'Sound') continue
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
    if (tool === 'note' || tool === 'text') {
      // 放置类工具需要干净页面：清选区、收起播放条
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
    this._store.remove(id)
  }

  private _beginPlacement(tool: 'note' | 'text', pageView: PageView, ev: MouseEvent) {
    const [x, y] = pageView.annotationLayer.pointOf(ev)
    const box = pageView.annotationLayer.root.getBoundingClientRect()
    this._notePop.open(pageView.root, {
      kind: tool,
      initial: '',
      left: ev.clientX - box.left,
      top: ev.clientY - box.top,
      onSave: (text) => {
        if (text) {
          this._store.add({
            id: createAnnotationId(),
            type: tool,
            page: pageView.pageNum,
            rects: [[x, y, x, y]],
            text,
            createdAt: Date.now(),
          })
        }
        // 便签允许连放；文字放完自动回指针，避免误点出一堆空框
        if (tool === 'text') this.setTool('select')
      },
    })
  }

  private _activateAnnotation(record: AnnotationRecord, pageView: PageView) {
    if (record.type !== 'note' && record.type !== 'text') return
    const [x, y] = record.rects[0] ?? [0, 0, 0, 0]
    const width = pageView.root.clientWidth
    const height = pageView.root.clientHeight
    this._notePop.open(pageView.root, {
      kind: record.type,
      initial: record.text ?? '',
      left: x * width + 14,
      top: y * height + 14,
      editing: true,
      onSave: (text) => this._store.setText(record.id, text),
      onDelete: () => this._store.remove(record.id),
    })
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
      if (this._notePop.isOpen) {
        this._notePop.close()
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
