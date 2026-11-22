import { Destroyable, react } from '@vtxfp/vtxf-basic-tools-202607/browser'

export type AnnotationType = 'highlight' | 'underline' | 'note' | 'text'

/**
 * 一条批注。坐标一律归一化到页面（0-1，左上原点），
 * 与缩放、DPR、页面尺寸无关，换分辨率重开不会漂移。
 */
export interface AnnotationRecord {
  id: string
  type: AnnotationType
  /** 1 基页码 */
  page: number
  /** 高亮/下划线：每行一个矩形；便签/文字：只存左上角点 [x,y,x,y] */
  rects: [number, number, number, number][]
  /** 便签 / 文字内容 */
  text?: string
  createdAt: number
}

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

  async save() {
    const path = this._pdfPath.value
    if (!path) return
    await window.bridge.writeAnnotations(path, this.records)
  }
}
