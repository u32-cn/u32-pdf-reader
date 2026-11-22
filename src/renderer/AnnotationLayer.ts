import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import { createAnnotationId, type AnnotationRecord } from './AnnotationStore'

export interface AnnotationLayerOptions {
  page: number
  /** 点击/双击已有批注（便签点开编辑、文字双击编辑） */
  onActivate: (record: AnnotationRecord, ev: MouseEvent) => void
}

class AnnotationLayerBase extends Destroyable {
  constructor(protected _opt: AnnotationLayerOptions) {
    super()
  }
}

/**
 * 单页批注层：只负责把记录画成 DOM，并把文字选区换算成归一化矩形。
 * 命中测试与状态变更都在 App，层本身无状态（render 幂等）。
 */
export class AnnotationLayer extends AnnotationLayerBase {
  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'annotation-layer'
    div.dataset.u32Name = `annotation-layer-${this._opt.page}`
    return div
  })()

  /** 页面内容盒（与 canvas 完全重合），归一化坐标的基准 */
  private get _box(): DOMRect {
    return this.root.getBoundingClientRect()
  }

  render(records: AnnotationRecord[]) {
    this.root.replaceChildren()
    for (const r of records) {
      if (r.type === 'note') {
        this._renderNote(r)
      } else if (r.type === 'text') {
        this._renderText(r)
      } else {
        this._renderMarks(r)
      }
    }
  }

  private _renderMarks(r: AnnotationRecord) {
    const cls = r.type === 'highlight' ? 'anno-hl' : 'anno-ul'
    for (const [x0, y0, x1, y1] of r.rects) {
      const div = document.createElement('div')
      div.className = cls
      div.dataset.u32Name = r.type === 'highlight' ? 'annotation-highlight' : 'annotation-underline'
      div.dataset.id = r.id
      div.style.left = `${x0 * 100}%`
      div.style.width = `${Math.max(x1 - x0, 0.001) * 100}%`
      if (r.type === 'highlight') {
        // 选区矩形含整行行高，上下各收一点才像荧光笔而不是色块
        const h = Math.max(y1 - y0, 0.001)
        div.style.top = `${(y0 + h * 0.07) * 100}%`
        div.style.height = `${h * 0.86 * 100}%`
      } else {
        div.style.top = `${y1 * 100}%`
      }
      this.root.appendChild(div)
    }
  }

  private _renderNote(r: AnnotationRecord) {
    const [x, y] = r.rects[0] ?? [0, 0, 0, 0]
    const btn = document.createElement('button')
    btn.className = 'anno-note'
    btn.dataset.u32Name = 'annotation-note'
    btn.dataset.id = r.id
    btn.type = 'button'
    btn.title = r.text || '便签'
    btn.style.left = `${x * 100}%`
    btn.style.top = `${y * 100}%`
    btn.style.transform = 'translate(-50%, -50%)'
    btn.innerHTML =
      '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M2.4 3.2h7.2M2.4 6h7.2M2.4 8.8h4.2"/></svg>'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      this._opt.onActivate(r, e)
    })
    this.root.appendChild(btn)
  }

  private _renderText(r: AnnotationRecord) {
    const [x, y] = r.rects[0] ?? [0, 0, 0, 0]
    const div = document.createElement('div')
    div.className = 'anno-text'
    div.dataset.u32Name = 'annotation-text'
    div.dataset.id = r.id
    div.textContent = r.text || ''
    div.title = '双击编辑'
    div.style.left = `${x * 100}%`
    div.style.top = `${y * 100}%`
    // 字号跟页面宽度挂钩：缩放时文字与正文同比例，不会变成一颗小字
    const box = this._box
    const size = Math.max(10, Math.round(box.width * 0.021))
    div.style.fontSize = `${size}px`
    div.style.maxWidth = `${Math.round(box.width * 0.55)}px`
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      this._opt.onActivate(r, e)
    })
    this.root.appendChild(div)
  }

  /** 当前选区是否落在本页 */
  hasSelection(): boolean {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
    const range = sel.getRangeAt(0)
    const pageEl = this.root.parentElement
    return !!pageEl && pageEl.contains(range.commonAncestorContainer)
  }

  /** 把当前选区按行换算成归一化矩形；不构造成记录，交由调用方决定类型 */
  readSelectionRects(): [number, number, number, number][] {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return []
    const range = sel.getRangeAt(0)
    const box = this._box
    if (box.width === 0 || box.height === 0) return []
    const out: [number, number, number, number][] = []
    const list = range.getClientRects()
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      if (r.width < 1 || r.height < 1) continue
      out.push([
        clamp01((r.left - box.left) / box.width),
        clamp01((r.top - box.top) / box.height),
        clamp01((r.right - box.left) / box.width),
        clamp01((r.bottom - box.top) / box.height),
      ])
    }
    return out
  }

  /** 由选区直接产出一条批注记录（不落库） */
  recordFromSelection(type: 'highlight' | 'underline'): AnnotationRecord | null {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const quoted = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 300)
    const rects = this.readSelectionRects()
    if (rects.length === 0) return null
    sel.removeAllRanges()
    return {
      id: createAnnotationId(),
      type,
      page: this._opt.page,
      rects,
      text: quoted || undefined,
      createdAt: Date.now(),
    }
  }

  /** 鼠标位置 → 归一化坐标 */
  pointOf(ev: MouseEvent): [number, number] {
    const box = this._box
    if (box.width === 0 || box.height === 0) return [0, 0]
    return [clamp01((ev.clientX - box.left) / box.width), clamp01((ev.clientY - box.top) / box.height)]
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
