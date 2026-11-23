import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import {
  createAnnotationId,
  DEFAULT_ANNO_STYLE,
  FONT_SIZE_STEPS,
  type AnnotationRecord,
  type ShapeKind,
} from './AnnotationStore'

export interface AnnotationLayerOptions {
  page: number
  /** 点击/双击已有批注（便签点开编辑、文字双击编辑、ink/shape 选样式） */
  onActivate: (record: AnnotationRecord, ev: MouseEvent) => void
}

class AnnotationLayerBase extends Destroyable {
  constructor(protected _opt: AnnotationLayerOptions) {
    super()
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 归一化点转 SVG 坐标（viewBox 0 0 1000 1000 等比） */
function ptsAttr(rects: AnnotationRecord['rects']): string {
  return rects.map(([x, y]) => `${round2(x * 1000)},${round2(y * 1000)}`).join(' ')
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function c01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 单页批注层：只负责把记录画成 DOM，并把文字选区/鼠标坐标换算成归一化值。
 * 命中测试与状态变更都在 App，层本身无状态（render 幂等）。
 */
export class AnnotationLayer extends AnnotationLayerBase {
  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'annotation-layer'
    div.dataset.u32Name = `annotation-layer-${this._opt.page}`
    return div
  })()

  /** ink / shape 共用的 SVG 画布层（整体 pointer-events:none，命中交给图形元素） */
  private readonly _svg: SVGSVGElement = (() => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
    svg.classList.add('anno-svg')
    svg.setAttribute('viewBox', '0 0 1000 1000')
    svg.setAttribute('preserveAspectRatio', 'none')
    return svg
  })()

  /** 页面内容盒（与 canvas 完全重合），归一化坐标的基准 */
  private get _box(): DOMRect {
    return this.root.getBoundingClientRect()
  }

  render(records: AnnotationRecord[]) {
    this.root.replaceChildren()
    this._svg.replaceChildren()
    for (const r of records) {
      if (r.type === 'note') {
        this._renderNote(r)
      } else if (r.type === 'text') {
        this._renderText(r)
      } else if (r.type === 'ink') {
        this._renderInk(r)
      } else if (r.type === 'shape') {
        this._renderShape(r)
      } else {
        this._renderMarks(r)
      }
    }
    if (this._svg.childElementCount > 0) this.root.appendChild(this._svg)
  }

  private _renderMarks(r: AnnotationRecord) {
    const cls = r.type === 'highlight' ? 'anno-hl' : 'anno-ul'
    const color = r.style?.color
    for (const [x0, y0, x1, y1] of r.rects) {
      const div = document.createElement('div')
      div.className = cls
      div.dataset.u32Name = r.type === 'highlight' ? 'annotation-highlight' : 'annotation-underline'
      div.dataset.id = r.id
      if (color) div.style.background = color
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
    if (r.style?.background) btn.style.background = r.style.background
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
    const style = { ...DEFAULT_ANNO_STYLE, ...r.style }
    const div = document.createElement('div')
    div.className = 'anno-text'
    div.dataset.u32Name = 'annotation-text'
    div.dataset.id = r.id
    div.textContent = r.text || ''
    div.title = '双击编辑'
    div.style.left = `${x * 100}%`
    div.style.top = `${y * 100}%`
    // 字号跟页面宽度挂钩：缩放时文字与正文同比例，不会变成一颗小字。
    // 页面未挂载时宽度为 0，会算出 0px 最大宽度把文字压成竖排，此时跳过
    //（调用方在挂载后会 repaint 补画）
    const box = this._box
    if (box.width <= 0) return
    const size = Math.max(10, Math.round(box.width * FONT_SIZE_STEPS[style.fontSize]))
    div.style.fontSize = `${size}px`
    div.style.maxWidth = `${Math.round(box.width * 0.55)}px`
    div.style.color = style.color
    div.style.background = style.background
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      this._opt.onActivate(r, e)
    })
    this.root.appendChild(div)
  }

  private _renderInk(r: AnnotationRecord) {
    if (r.rects.length < 2) return
    const style = { ...DEFAULT_ANNO_STYLE, ...r.style }
    const poly = document.createElementNS(SVG_NS, 'polyline')
    poly.setAttribute('points', ptsAttr(r.rects))
    poly.setAttribute('fill', 'none')
    poly.setAttribute('stroke', style.color)
    // viewBox 1000 宽对应页面宽 px；preserveAspectRatio=none 时 y 方向同样被拉伸，
    // 线宽按页面宽度换算保持视觉粗细一致
    const w = style.strokeWidth ?? DEFAULT_ANNO_STYLE.strokeWidth
    poly.setAttribute('stroke-width', String(Math.max((w / this._box.width) * 1000, 0.6)))
    poly.setAttribute('stroke-linecap', 'round')
    poly.setAttribute('stroke-linejoin', 'round')
    poly.dataset.u32Name = 'annotation-ink'
    poly.dataset.id = r.id
    poly.classList.add('anno-hit')
    poly.addEventListener('click', (e) => {
      e.stopPropagation()
      this._opt.onActivate(r, e)
    })
    this._svg.appendChild(poly)
  }

  private _renderShape(r: AnnotationRecord) {
    const [x0, y0, x1, y1] = r.rects[0] ?? [0, 0, 0, 0]
    const style = { ...DEFAULT_ANNO_STYLE, ...r.style }
    const ax = c01(x0) * 1000
    const ay = c01(y0) * 1000
    const bx = c01(x1) * 1000
    const by = c01(y1) * 1000
    const w = style.strokeWidth ?? DEFAULT_ANNO_STYLE.strokeWidth
    const sw = String(Math.max((w / this._box.width) * 1000, 0.6))
    let el: SVGElement
    switch (r.shape ?? 'rect') {
      case 'ellipse': {
        el = document.createElementNS(SVG_NS, 'ellipse')
        el.setAttribute('cx', String((ax + bx) / 2))
        el.setAttribute('cy', String((ay + by) / 2))
        el.setAttribute('rx', String(Math.abs(bx - ax) / 2))
        el.setAttribute('ry', String(Math.abs(by - ay) / 2))
        break
      }
      case 'line': {
        el = document.createElementNS(SVG_NS, 'line')
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
        // 箭头头部长度随线长自适应（viewBox 单位），封顶避免短线爆头
        const head = Math.max(Math.min(len * 0.16, 60), 12)
        const ux = dx / len
        const uy = dy / len
        el = document.createElementNS(SVG_NS, 'path')
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
        el = document.createElementNS(SVG_NS, 'rect')
        el.setAttribute('x', String(Math.min(ax, bx)))
        el.setAttribute('y', String(Math.min(ay, by)))
        el.setAttribute('width', String(Math.abs(bx - ax)))
        el.setAttribute('height', String(Math.abs(by - ay)))
      }
    }
    el.setAttribute('fill', 'none')
    el.setAttribute('stroke', style.color)
    el.setAttribute('stroke-width', sw)
    el.setAttribute('stroke-linecap', 'round')
    el.setAttribute('stroke-linejoin', 'round')
    el.dataset.u32Name = 'annotation-shape'
    el.dataset.id = r.id
    el.classList.add('anno-hit')
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      this._opt.onActivate(r, e)
    })
    this._svg.appendChild(el)
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
        c01((r.left - box.left) / box.width),
        c01((r.top - box.top) / box.height),
        c01((r.right - box.left) / box.width),
        c01((r.bottom - box.top) / box.height),
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
    return [c01((ev.clientX - box.left) / box.width), c01((ev.clientY - box.top) / box.height)]
  }
}

export type { ShapeKind }
