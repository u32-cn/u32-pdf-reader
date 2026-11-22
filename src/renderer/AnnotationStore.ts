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

/**
 * 批注仓库：唯一的状态持有者，持久化为与 PDF 同名的 `.annotations.json`。
 * 视图只读 `records` 并订阅 `recordsChanged`，业务只写这里。
 */
export class AnnotationStore extends Destroyable {
  private _records = this.disposeVar(react<AnnotationRecord[]>([]))
  get records() {
    return this._records.value
  }
  get recordsChanged() {
    return this._records.changed
  }

  /** 当前文档路径；null 表示未打开 */
  private _pdfPath = this.disposeVar(react<string | null>(null))
  get pdfPath() {
    return this._pdfPath.value
  }
  get pdfPathChanged() {
    return this._pdfPath.changed
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

  /** 切换文档：换路径 + 读回旁注 */
  async load(pdfPath: string) {
    this._pdfPath.value = pdfPath
    const saved = (await window.bridge.readAnnotations(pdfPath)) as AnnotationRecord[] | null
    this._records.value = Array.isArray(saved)
      ? saved.filter((r) => r && typeof r.page === 'number' && Array.isArray(r.rects))
      : []
  }

  clear() {
    this._records.value = []
  }

  add(record: AnnotationRecord) {
    this._records.value = [...this.records, record]
    void this.save()
  }

  remove(id: string) {
    this._records.value = this.records.filter((r) => r.id !== id)
    void this.save()
  }

  setText(id: string, text: string) {
    const trimmed = text.trim()
    if (!trimmed) {
      this.remove(id)
      return
    }
    this._records.value = this.records.map((r) => (r.id === id ? { ...r, text: trimmed } : r))
    void this.save()
  }

  /** 更新样式（合并字段，不动其他属性） */
  updateStyle(id: string, style: AnnotationStyle) {
    this._records.value = this.records.map((r) =>
      r.id === id ? { ...r, style: { ...r.style, ...style } } : r,
    )
    void this.save()
  }

  async save() {
    const path = this._pdfPath.value
    if (!path) return
    await window.bridge.writeAnnotations(path, this.records)
  }
}
