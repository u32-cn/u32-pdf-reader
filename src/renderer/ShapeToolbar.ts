import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import { PALETTE } from './AnnotationStore'
import { icons } from './icons'

export interface ShapeToolbarOptions {
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onDelete: () => void
}

class ShapeToolbarBase extends Destroyable {
  constructor(protected _opt: ShapeToolbarOptions) {
    super()
  }
}

/**
 * 手绘/图形批注的就地小工具条：调色板 + 线宽 + 删除。
 * 选中 shape/ink 时挂在 .page-shell 内、锚在图形上方；点空白或 Esc 收起。
 */
export class ShapeToolbar extends ShapeToolbarBase {
  private readonly _swatches: HTMLButtonElement[] = []
  private readonly _widthBtns: HTMLButtonElement[] = []

  private readonly _colors: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'stb-group'
    div.dataset.u32Name = 'shape-tb-colors'
    for (const c of PALETTE) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'np-swatch'
      b.dataset.u32Name = 'shape-tb-color'
      b.dataset.color = c
      b.title = '换颜色'
      b.style.background = c
      b.addEventListener('click', () => {
        this._syncPressed(this._swatches, b)
        this._opt.onColor(c)
      })
      this._swatches.push(b)
      div.appendChild(b)
    }
    return div
  })()

  private readonly _widths: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'stb-group'
    div.dataset.u32Name = 'shape-tb-widths'
    for (const w of [2, 4, 7]) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'db-width'
      b.dataset.u32Name = `shape-tb-width-${w}`
      b.dataset.width = String(w)
      b.title = `线宽 ${w}`
      const dot = document.createElement('i')
      dot.style.width = dot.style.height = `${w}px`
      b.appendChild(dot)
      b.addEventListener('click', () => {
        this._syncPressed(this._widthBtns, b)
        this._opt.onWidth(w)
      })
      this._widthBtns.push(b)
      div.appendChild(b)
    }
    return div
  })()

  private readonly _deleteBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'np-btn danger'
    btn.dataset.u32Name = 'shape-tb-delete'
    btn.title = '删除（Delete）'
    btn.innerHTML = icons.trash
    btn.addEventListener('click', () => this._opt.onDelete())
    return btn
  })()

  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'shape-tb'
    div.dataset.u32Name = 'shape-toolbar'
    div.hidden = true
    div.appendChild(this._colors)
    div.appendChild(this._widths)
    div.appendChild(this._deleteBtn)
    return div
  })()

  private _pageEl: HTMLElement | null = null

  constructor(opt: ShapeToolbarOptions) {
    super(opt)
    this.dispose(() => this.root.remove())
  }

  get isOpen() {
    return !this.root.hidden
  }

  /** 挂到图形所在页面，锚在归一化包围盒上方 */
  open(pageEl: HTMLElement, rect: { left: number; top: number; right: number; bottom: number }) {
    if (this._pageEl && this._pageEl !== pageEl) this.root.remove()
    this._pageEl = pageEl
    if (this.root.parentElement !== pageEl) pageEl.appendChild(this.root)
    this.root.hidden = false

    const pageW = pageEl.clientWidth
    const w = this.root.offsetWidth || 220
    const h = this.root.offsetHeight || 30
    const maxLeft = Math.max(pageW - w - 6, 6)
    const left = Math.min(Math.max(rect.left * pageW, 6), maxLeft)
    let top = rect.top * pageEl.clientHeight - h - 8
    if (top < 6) top = rect.bottom * pageEl.clientHeight + 8
    this.root.style.left = `${Math.round(left)}px`
    this.root.style.top = `${Math.round(top)}px`
  }

  close() {
    if (!this.isOpen) return
    this.root.hidden = true
    this.root.remove()
    this._pageEl = null
  }

  /** 回显当前 style */
  sync(color: string, width: number) {
    for (const b of this._swatches) {
      b.setAttribute('aria-pressed', String(b.dataset.color === color))
    }
    for (const b of this._widthBtns) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.width) === width))
    }
  }

  private _syncPressed(btns: HTMLButtonElement[], active: HTMLButtonElement) {
    for (const b of btns) b.setAttribute('aria-pressed', String(b === active))
  }
}
