import { Destroyable, react } from '@vtxfp/vtxf-basic-tools-202607/browser'

export type AnnotationType = 'highlight' | 'underline' | 'note' | 'text' | 'ink' | 'shape'
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'

/** 批注样式：全部可选，旧 JSON 无此字段时用默认值 */
export interface AnnotationStyle {
  /** 主色（文字色 / 描边色 / 高亮色） */
  color?: string
  /** 文字 / 便签背景色 */
  background?: string
  /** 文字字号档位：1 小 / 2 中 / 3 大 */
  fontSize?: 1 | 2 | 3
  /** 手绘 / 图形线宽（px @ 适应宽度，随页面缩放） */
  strokeWidth?: number
}

/**
 * 一条批注。坐标一律归一化到页面（0-1，左上原点），
 * 与缩放、DPR、页面尺寸无关，换分辨率重开不会漂移。
 */
export interface AnnotationRecord {
  id: string
  type: AnnotationType
  /** 1 基页码 */
  page: number
  /**
   * 高亮/下划线：每行一个矩形；便签/文字：左上角点 [x,y,x,y]；
   * 手绘：逐点 [x,y,0,0]（归一化折线顶点，按序连接）；
   * 图形：两个对角点 [x0,y0,x1,y1]。
   */
  rects: [number, number, number, number][]
  /** 便签 / 文字内容 */
  text?: string
  /** 图形种类（type=shape 时有效） */
  shape?: ShapeKind
  style?: AnnotationStyle
  createdAt: number
}

/** 用户书签：页码 + 可选标题，持久化在 annotations.json 的 bookmarks 字段 */
export interface BookmarkRecord {
  page: number
  title?: string
  createdAt: number
}

/** sidecar 文件整体结构：批注数组或带 bookmarks 的对象都兼容 */
interface SidecarData {
  annotations?: AnnotationRecord[]
  bookmarks?: BookmarkRecord[]
}

/** 无样式字段时的渲染默认值 */
export const DEFAULT_ANNO_STYLE = {
  color: '#8b3a2e',
  background: '#fffaea',
  fontSize: 2 as 1 | 2 | 3,
  strokeWidth: 2,
}

/** 文字字号档位（页面宽度比例），随缩放同比 */
export const FONT_SIZE_STEPS: Record<1 | 2 | 3, number> = { 1: 0.016, 2: 0.021, 3: 0.03 }

/** 调色板：样式条与绘制工具共用 */
export const PALETTE = ['#8b3a2e', '#c9803a', '#b5a642', '#4a7c59', '#3d5a80', '#6b4e8e', '#1b1a17'] as const

export function createAnnotationId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 单条逆操作：undo 执行 it，redo 执行 it 的逆 */
type UndoEntry =
  | { kind: 'add'; record: AnnotationRecord }
  | { kind: 'remove'; record: AnnotationRecord }
  | { kind: 'setText'; id: string; before: string | undefined; after: string }
  | { kind: 'updateStyle'; id: string; before: AnnotationStyle | undefined; after: AnnotationStyle }

/** 历史栈上限：够用且防内存爆 */
const HISTORY_MAX = 200

/**
 * 批注仓库：唯一的状态持有者，持久化为与 PDF 同名的 `.annotations.json`。
 * 视图只读 `records` 并订阅 `recordsChanged`，业务只写这里。
 * 自带操作级撤销/重做（不含书签操作）。
 */
export class AnnotationStore extends Destroyable {
  private _records = this.disposeVar(react<AnnotationRecord[]>([]))
  get records() {
    return this._records.value
  }
  get recordsChanged() {
    return this._records.changed
  }

  private _bookmarks = this.disposeVar(react<BookmarkRecord[]>([]))
  get bookmarks() {
    return this._bookmarks.value
  }
  get bookmarksChanged() {
    return this._bookmarks.changed
  }
  get bookmarksVar() {
    return this._bookmarks
  }
  /** 书签变化（react var 本体，TopBar watch 用） */
  get bookmarksReactive() {
    return this._bookmarks
  }

  /** 当前文档路径；null 表示未打开 */
  private _pdfPath = this.disposeVar(react<string | null>(null))
  get pdfPath() {
    return this._pdfPath.value
  }
  get pdfPathChanged() {
    return this._pdfPath.changed
  }

  /** 撤销栈 / 重做栈 */
  private _undoStack: UndoEntry[] = []
  private _redoStack: UndoEntry[] = []

  private _historyChanged = this.disposeVar(react(0))
  get historyChanged() {
    return this._historyChanged
  }
  get canUndo() {
    return this._undoStack.length > 0
  }
  get canRedo() {
    return this._redoStack.length > 0
  }

  byPage(page: number): AnnotationRecord[] {
    return this.records.filter((r) => r.page === page)
  }

  /** 给视图用的响应式引用（视图 watch 它，自己改自己的 DOM） */
  get recordsVar() {
    return this._records
  }

  countOf(page: number): number {
    return this.records.reduce((n, r) => (r.page === page ? n + 1 : n), 0)
  }

  /** 切换文档：换路径 + 读回旁注与书签，清空历史栈 */
  async load(pdfPath: string) {
    this._pdfPath.value = pdfPath
    const saved = (await window.bridge.readAnnotations(pdfPath)) as SidecarData | AnnotationRecord[] | null
    if (Array.isArray(saved)) {
      // 旧格式：纯批注数组
      this._records.value = saved.filter((r) => r && typeof r.page === 'number' && Array.isArray(r.rects))
      this._bookmarks.value = []
    } else if (saved && typeof saved === 'object') {
      const annotations = Array.isArray(saved.annotations) ? saved.annotations : []
      this._records.value = annotations.filter((r) => r && typeof r.page === 'number' && Array.isArray(r.rects))
      this._bookmarks.value = Array.isArray(saved.bookmarks)
        ? saved.bookmarks.filter((b) => b && typeof b.page === 'number')
        : []
    } else {
      this._records.value = []
      this._bookmarks.value = []
    }
    this._undoStack = []
    this._redoStack = []
    this._historyChanged.value++
  }

  clear() {
    this._records.value = []
    this._bookmarks.value = []
    this._undoStack = []
    this._redoStack = []
    this._historyChanged.value++
  }

  add(record: AnnotationRecord) {
    this._records.value = [...this.records, record]
    this._pushUndo({ kind: 'add', record })
    void this.save()
  }

  remove(id: string) {
    const record = this.records.find((r) => r.id === id)
    this._records.value = this.records.filter((r) => r.id !== id)
    if (record) this._pushUndo({ kind: 'remove', record })
    void this.save()
  }

  setText(id: string, text: string) {
    const trimmed = text.trim()
    const before = this.records.find((r) => r.id === id)?.text
    if (!trimmed) {
      this.remove(id)
      return
    }
    this._records.value = this.records.map((r) => (r.id === id ? { ...r, text: trimmed } : r))
    this._pushUndo({ kind: 'setText', id, before, after: trimmed })
    void this.save()
  }

  /** 更新样式（合并字段，不动其他属性） */
  updateStyle(id: string, style: AnnotationStyle) {
    const before = this.records.find((r) => r.id === id)?.style
    this._records.value = this.records.map((r) =>
      r.id === id ? { ...r, style: { ...r.style, ...style } } : r,
    )
    this._pushUndo({ kind: 'updateStyle', id, before, after: { ...before, ...style } })
    void this.save()
  }

  undo() {
    const entry = this._undoStack.pop()
    if (!entry) return
    this._applyInverse(entry)
    this._redoStack.push(entry)
    this._historyChanged.value++
    void this.save()
  }

  redo() {
    const entry = this._redoStack.pop()
    if (!entry) return
    this._applyForward(entry)
    this._undoStack.push(entry)
    this._historyChanged.value++
    void this.save()
  }

  /** 执行 entry 的逆操作（undo 方向） */
  private _applyInverse(entry: UndoEntry) {
    switch (entry.kind) {
      case 'add':
        this._records.value = this.records.filter((r) => r.id !== entry.record.id)
        break
      case 'remove':
        this._records.value = [...this.records, entry.record]
        break
      case 'setText':
        this._setTextRaw(entry.id, entry.before)
        break
      case 'updateStyle':
        this._setStyleRaw(entry.id, entry.before)
        break
    }
  }

  /** 执行 entry 的正向操作（redo 方向） */
  private _applyForward(entry: UndoEntry) {
    switch (entry.kind) {
      case 'add':
        this._records.value = [...this.records, entry.record]
        break
      case 'remove':
        this._records.value = this.records.filter((r) => r.id !== entry.record.id)
        break
      case 'setText':
        this._setTextRaw(entry.id, entry.after)
        break
      case 'updateStyle':
        this._setStyleRaw(entry.id, entry.after)
        break
    }
  }

  private _setTextRaw(id: string, text: string | undefined) {
    this._records.value = this.records.map((r) => (r.id === id ? { ...r, text } : r))
  }

  private _setStyleRaw(id: string, style: AnnotationStyle | undefined) {
    this._records.value = this.records.map((r) => (r.id === id ? { ...r, style } : r))
  }

  private _pushUndo(entry: UndoEntry) {
    this._undoStack.push(entry)
    if (this._undoStack.length > HISTORY_MAX) this._undoStack.shift()
    this._redoStack = []
    this._historyChanged.value++
  }

  // ---- 书签（不进历史栈） ----

  /** 当前页是否已有书签 */
  hasBookmark(page: number): BookmarkRecord | undefined {
    return this.bookmarks.find((b) => b.page === page)
  }

  toggleBookmark(page: number) {
    if (this.hasBookmark(page)) {
      this._bookmarks.value = this.bookmarks.filter((b) => b.page !== page)
    } else {
      this._bookmarks.value = [...this.bookmarks, { page, createdAt: Date.now() }].sort(
        (a, b) => a.page - b.page,
      )
    }
    void this.save()
  }

  async save() {
    const path = this._pdfPath.value
    if (!path) return
    await window.bridge.writeAnnotations(path, {
      annotations: this.records,
      bookmarks: this.bookmarks,
    })
  }
}
