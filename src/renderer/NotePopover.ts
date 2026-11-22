import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import { PALETTE, type AnnotationStyle } from './AnnotationStore'
import { icons } from './icons'

export type NoteKind = 'note' | 'text'

export interface NotePopoverRequest {
  kind: NoteKind
  initial: string
  /** 页面内坐标（px） */
  left: number
  top: number
  /** 编辑已有批注时为 true，显示删除 */
  editing?: boolean
  /** 初始样式（编辑时回显） */
  style?: AnnotationStyle
  /** 样式变化（实时预览，保存时随记录落库） */
  onStyle?: (style: AnnotationStyle) => void
  onSave: (text: string) => void
  onDelete?: () => void
}

/**
 * 便签/文字的就地弹窗：文本 + 样式条（字号 3 档 / 调色板选文字色与背景色）。
 * 替代 v1 的 window.prompt（Electron 已移除该 API，调用即抛错）。
 */
export class NotePopover extends Destroyable {
  private readonly _hint = (() => {
    const span = document.createElement('span')
    span.className = 'np-hint'
    span.dataset.u32Name = 'note-pop-hint'
    return span
  })()

  private readonly _closeBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'np-btn danger'
    btn.dataset.u32Name = 'note-pop-close'
    btn.title = '关闭（Esc）'
    btn.innerHTML = icons.close
    btn.addEventListener('click', () => this.close())
    return btn
  })()

  private readonly _head: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'np-head'
    div.dataset.u32Name = 'note-pop-head'
    div.appendChild(this._hint)
    div.appendChild(this._closeBtn)
    return div
  })()

  private readonly _input: HTMLTextAreaElement = (() => {
    const ta = document.createElement('textarea')
    ta.dataset.u32Name = 'note-pop-input'
    ta.rows = 3
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        this._commit()
      }
    })
    return ta
  })()

  /** 样式条：字号 A- A A+ ｜ 文字色 7 色 ｜ 背景色 7 色 */
  private readonly _styleBar: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'np-style'
    div.dataset.u32Name = 'note-pop-style'
    return div
  })()

  private _style: AnnotationStyle = {}
  private _kind: NoteKind = 'text'

  private readonly _saveBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'np-btn primary'
    btn.dataset.u32Name = 'note-pop-save'
    btn.textContent = '保存'
    btn.addEventListener('click', () => this._commit())
    return btn
  })()

  private readonly _deleteBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'np-btn danger'
    btn.dataset.u32Name = 'note-pop-delete'
    btn.textContent = '删除'
    btn.addEventListener('click', () => {
      const req = this._req
      this.close()
      req?.onDelete?.()
    })
    return btn
  })()

  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'note-pop'
    div.dataset.u32Name = 'note-pop'
    div.hidden = true
    div.appendChild(this._head)
    div.appendChild(this._input)
    div.appendChild(this._styleBar)

    const foot = document.createElement('div')
    foot.className = 'np-foot'
    foot.dataset.u32Name = 'note-pop-foot'
    foot.appendChild(this._deleteBtn)
    const spacer = document.createElement('span')
    spacer.className = 'np-hint'
    spacer.dataset.u32Name = 'note-pop-spacer'
    foot.appendChild(spacer)
    foot.appendChild(this._saveBtn)
    div.appendChild(foot)
    return div
  })()

  private _req: NotePopoverRequest | null = null
  private _pageEl: HTMLElement | null = null

  constructor() {
    super()
    this.dispose(() => this.root.remove())
  }

  get isOpen() {
    return !this.root.hidden
  }

  get pageEl() {
    return this._pageEl
  }

  get currentStyle(): AnnotationStyle {
    return { ...this._style }
  }

  open(pageEl: HTMLElement, req: NotePopoverRequest) {
    if (this._pageEl && this._pageEl !== pageEl) this.root.remove()
    this._pageEl = pageEl
    this._req = req
    this._kind = req.kind
    this._style = { ...req.style }

    this._hint.textContent = req.kind === 'note' ? '便签' : '文字'
    this._input.placeholder = req.kind === 'note' ? '写点什么…（Ctrl+Enter 保存）' : '输入要放在页面上的文字…'
    this._input.value = req.initial
    this._deleteBtn.hidden = !req.editing
    this._saveBtn.textContent = req.editing ? '更新' : '保存'
    this._buildStyleBar()
    // 挂到目标页面（页面缩放重建后旧挂载点被替换，必须重新 append）
    if (this.root.parentElement !== pageEl) pageEl.appendChild(this.root)
    this.root.hidden = false

    // 先显形再量尺寸，然后夹到页面内
    const w = this.root.offsetWidth || 236
    const h = this.root.offsetHeight || 170
    const pageW = pageEl.clientWidth
    const pageH = pageEl.clientHeight
    const maxLeft = Math.max(pageW - w - 6, 6)
    let left = Math.min(Math.max(req.left, 6), maxLeft)
    let top = req.top
    if (top + h > pageH - 6) top = Math.max(req.top - h - 24, 6)
    this.root.style.left = `${Math.round(left)}px`
    this.root.style.top = `${Math.round(top)}px`

    this._input.focus()
    this._setSelectionEnd()
  }

  close() {
    if (!this.isOpen) return
    this.root.hidden = true
    // 弹窗挂在页面内：页面缩放重建后旧 DOM 会被整体替换，
    // close 时顺手摘下来，下次 open 再挂到新页面，避免 querySelector 落空
    this.root.remove()
    this._req = null
    this._input.value = ''
  }

  private _setSelectionEnd() {
    this._input.focus()
    const len = this._input.value.length
    this._input.setSelectionRange(len, len)
  }

  private _emitStyle() {
    this._req?.onStyle?.({ ...this._style })
  }

  /** 重建样式条（open 时调用一次；点击只更新选中态与回调，不重建 DOM） */
  private _buildStyleBar() {
    this._styleBar.replaceChildren()
    if (this._kind !== 'text' && this._kind !== 'note') return

    // 字号组
    const sizeGroup = document.createElement('div')
    sizeGroup.className = 'np-group'
    sizeGroup.dataset.u32Name = 'np-size-group'
    const steps: Array<1 | 2 | 3> = [1, 2, 3]
    const sizeBtns: HTMLButtonElement[] = []
    for (const s of steps) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'np-swatch np-size'
      b.dataset.u32Name = `np-size-${s}`
      b.title = s === 1 ? '小字号' : s === 2 ? '中字号' : '大字号'
      b.textContent = s === 1 ? 'A' : s === 2 ? 'A' : 'A'
      if (s !== 2) b.style.fontSize = s === 1 ? '10px' : '14px'
      b.addEventListener('click', () => {
        this._style.fontSize = s
        this._syncPressed(sizeBtns, b)
        this._emitStyle()
      })
      sizeBtns.push(b)
      sizeGroup.appendChild(b)
    }
    this._styleBar.appendChild(sizeGroup)

    // 文字色组
    this._styleBar.appendChild(this._paletteGroup('np-color-group', '文字颜色', PALETTE, (c) => {
      this._style.color = c
      this._emitStyle()
    }))

    // 背景色组
    this._styleBar.appendChild(this._paletteGroup('np-bg-group', '背景颜色', PALETTE, (c) => {
      this._style.background = c
      this._emitStyle()
    }))

    this._syncStyleSelection()
  }

  private _paletteGroup(
    name: string,
    title: string,
    colors: readonly string[],
    onPick: (c: string) => void,
  ): HTMLDivElement {
    const group = document.createElement('div')
    group.className = 'np-group'
    group.dataset.u32Name = name
    group.title = title
    const btns: HTMLButtonElement[] = []
    for (const c of colors) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'np-swatch'
      b.dataset.color = c
      b.title = title
      b.style.background = c
      b.addEventListener('click', () => {
        onPick(c)
        this._syncPressed(btns, b)
      })
      btns.push(b)
      group.appendChild(b)
    }
    // 记住按钮组引用，供 _syncStyleSelection 回显选中态
    group.dataset.role = name
    return group
  }

  /** 按 this._style 回显样式条选中态 */
  private _syncStyleSelection() {
    const size = this._style.fontSize ?? 2
    for (const s of [1, 2, 3] as const) {
      const b = this._styleBar.querySelector<HTMLButtonElement>(`[data-u32-name="np-size-${s}"]`)
      b?.setAttribute('aria-pressed', String(s === size))
    }
    const colorGroup = this._styleBar.querySelector('[data-u32-name="np-color-group"]')
    const bgGroup = this._styleBar.querySelector('[data-u32-name="np-bg-group"]')
    this._syncSwatch(colorGroup, this._style.color)
    this._syncSwatch(bgGroup, this._style.background)
  }

  private _syncSwatch(group: Element | null, value: string | undefined) {
    if (!group) return
    for (const b of Array.from(group.querySelectorAll<HTMLButtonElement>('.np-swatch'))) {
      b.setAttribute('aria-pressed', String(!!value && b.dataset.color === value))
    }
  }

  private _syncPressed(btns: HTMLButtonElement[], active: HTMLButtonElement) {
    for (const b of btns) b.setAttribute('aria-pressed', String(b === active))
  }

  private _commit() {
    const req = this._req
    const text = this._input.value.trim()
    this.close()
    req?.onSave(text)
  }
}
