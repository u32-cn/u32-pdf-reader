import { Destroyable, react } from '@vtxfp/vtxf-basic-tools-202607/browser'

export interface AnnotationRecord {
  id: string
  type: 'highlight' | 'underline' | 'note'
  page: number
  /** 归一化矩形数组（0-1，左上原点），高亮/下划线各段一个 */
  rects: [number, number, number, number][]
  /** 便签文本 */
  text?: string
  createdAt: number
}

const CSS_PREFIX = 'u32--annotation-layer-ui--root--1763799200000'

/**
 * 批注层：挂在每个渲染页容器上的透明层。
 * 文字选区批注通过监听 selection 换算归一化矩形；便签点击空白处添加。
 */
export class AnnotationLayer extends Destroyable {
  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = CSS_PREFIX
    div.dataset.u32Name = 'annotation-layer'
    return div
  })()

  /** 全部批注记录（跨页） */
  private _records = this.disposeVar(react<AnnotationRecord[]>([]))
  get records() { return this._records.value }
  get recordsChanged() { return this._records.changed }

  /** 所属页码 */
  get pageNum() { return this._pageNum }
  constructor(private _pageNum: number) {
    super()
  }

  /** 恢复已保存批注：重建图形 */
  restore(records: AnnotationRecord[]) {
    for (const r of records) {
      if (r.page !== this._pageNum) continue
      this._records.value = [...this._records.value, r]
      this._renderRecord(r)
    }
  }

  /** 应用当前文字选区为高亮/下划线 */
  addFromSelection(type: 'highlight' | 'underline'): boolean {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
    const range = sel.getRangeAt(0)
    const pageEl = this.root.parentElement
    if (!pageEl || !pageEl.contains(range.commonAncestorContainer)) return false

    const pageRect = pageEl.getBoundingClientRect()
    const rects: [number, number, number, number][] = []
    // 逐行矩形换算为归一化坐标
    const clientRects = range.getClientRects()
    for (let i = 0; i < clientRects.length; i++) {
      const r = clientRects[i]
      rects.push([
        (r.left - pageRect.left) / pageRect.width,
        (r.top - pageRect.top) / pageRect.height,
        (r.right - pageRect.left) / pageRect.width,
        (r.bottom - pageRect.top) / pageRect.height,
      ])
    }
    if (rects.length === 0) return false
    sel.removeAllRanges()

    const record: AnnotationRecord = {
      id: `a${Date.now()}${Math.floor(Math.random() * 1000)}`,
      type,
      page: this._pageNum,
      rects,
      createdAt: Date.now(),
    }
    this._records.value = [...this._records.value, record]
    this._renderRecord(record)
    return true
  }

  /** 在指定归一化位置添加便签 */
  addNote(x: number, y: number, text: string): AnnotationRecord {
    const record: AnnotationRecord = {
      id: `a${Date.now()}${Math.floor(Math.random() * 1000)}`,
      type: 'note',
      page: this._pageNum,
      rects: [[x, y, x + 0.02, y + 0.02]],
      text,
      createdAt: Date.now(),
    }
    this._records.value = [...this._records.value, record]
    this._renderRecord(record)
    return record
  }

  private _renderRecord(r: AnnotationRecord) {
    for (const [x0, y0, x1, y1] of r.rects) {
      const div = document.createElement('div')
      div.dataset.u32Name = `annotation-${r.type}`
      div.style.position = 'absolute'
      div.style.left = `${x0 * 100}%`
      div.style.top = `${y0 * 100}%`
      div.style.width = `${(x1 - x0) * 100}%`
      div.style.height = `${(y1 - y0) * 100}%`
      if (r.type === 'highlight') {
        div.style.background = 'rgba(255, 210, 60, 0.4)'
      } else if (r.type === 'underline') {
        div.style.background = 'transparent'
        div.style.borderBottom = '2px solid #1a73e8'
        div.style.height = '0'
      } else {
        // 便签图标
        div.style.width = '18px'
        div.style.height = '18px'
        div.style.background = '#fbbc04'
        div.style.clipPath = 'polygon(0 0, 100% 0, 100% 75%, 75% 100%, 0 100%)'
        div.title = r.text || ''
      }
      this.root.appendChild(div)
    }
  }
}
