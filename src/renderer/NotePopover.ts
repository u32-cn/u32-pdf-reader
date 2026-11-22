import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'
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
  onSave: (text: string) => void
  onDelete?: () => void
}

/**
 * 便签/文字的就地弹窗。替代 v1 的 window.prompt（Electron 已移除该 API，调用即抛错）。
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

  open(pageEl: HTMLElement, req: NotePopoverRequest) {
    if (this._pageEl && this._pageEl !== pageEl) this.root.remove()
    this._pageEl = pageEl
    this._req = req
    if (this.root.parentElement !== pageEl) pageEl.appendChild(this.root)

    this._hint.textContent = req.kind === 'note' ? '便签' : '文字'
    this._input.placeholder = req.kind === 'note' ? '写点什么…（Ctrl+Enter 保存）' : '输入要放在页面上的文字…'
    this._input.value = req.initial
    this._deleteBtn.hidden = !req.editing
    this._saveBtn.textContent = req.editing ? '更新' : '保存'
    this.root.hidden = false

    // 先显形再量尺寸，然后夹到页面内
    const w = this.root.offsetWidth || 236
    const h = this.root.offsetHeight || 130
    const pageW = pageEl.clientWidth
    const pageH = pageEl.clientHeight
    const maxLeft = Math.max(pageW - w - 6, 6)
    let left = Math.min(Math.max(req.left, 6), maxLeft)
    let top = req.top
    if (top + h > pageH - 6) top = Math.max(req.top - h - 24, 6)
    this.root.style.left = `${Math.round(left)}px`
    this.root.style.top = `${Math.round(top)}px`

    this._input.focus()
    this._input.setSelectionRange(this._input.value.length, this._input.value.length)
  }

  close() {
    if (!this.isOpen) return
    this.root.hidden = true
    this._req = null
    this._input.value = ''
  }

  private _commit() {
    const req = this._req
    const text = this._input.value.trim()
    this.close()
    req?.onSave(text)
  }
}
