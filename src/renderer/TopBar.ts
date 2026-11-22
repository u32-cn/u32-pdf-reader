import { Destroyable, watch } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { ReactiveVariable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import { icons } from './icons'

export type ToolMode = 'select' | 'highlight' | 'underline' | 'note' | 'text'

export interface TopBarOptions {
  fileName: ReactiveVariable<string>
  totalPages: ReactiveVariable<number>
  currentPage: ReactiveVariable<number>
  zoom: ReactiveVariable<number>
  tool: ReactiveVariable<ToolMode>
  annoCount: ReactiveVariable<number>
  onOpen: () => void
  onToolChange: (t: ToolMode) => void
  onGoToPage: (n: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onToggleSidebar: () => void
}

interface ToolSpec {
  mode: ToolMode
  id: string
  icon: string
  label: string
  hint: string
}

const TOOLS: ToolSpec[] = [
  { mode: 'select', id: 'btn-select', icon: icons.select, label: '指针', hint: '指针（Esc）· 只选中不标注' },
  { mode: 'highlight', id: 'btn-highlight', icon: icons.highlight, label: '高亮', hint: '高亮（H）· 选中文字后自动套用' },
  { mode: 'underline', id: 'btn-underline', icon: icons.underline, label: '下划线', hint: '下划线（U）· 选中文字后自动套用' },
  { mode: 'note', id: 'btn-note', icon: icons.note, label: '便签', hint: '便签（N）· 在页面任意位置点一下放置' },
  { mode: 'text', id: 'btn-text', icon: icons.text, label: '文字', hint: '文字（T）· 在页面任意位置点一下输入' },
]

class TopBarBase extends Destroyable {
  constructor(protected _opt: TopBarOptions) {
    super()
  }
}

/**
 * 顶栏：左右两组靠边，五工具居中。
 * 显示全部由 watch 外部状态驱动，顶栏自己不持有业务状态。
 */
export class TopBar extends TopBarBase {
  private readonly _sidebarBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'btn-sidebar'
    btn.className = 'icon-btn'
    btn.dataset.u32Name = 'topbar-sidebar'
    btn.title = '显示/隐藏侧栏'
    btn.setAttribute('aria-expanded', 'true')
    btn.innerHTML = icons.sidebar
    btn.addEventListener('click', () => this._opt.onToggleSidebar())
    return btn
  })()

  private readonly _openBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'btn-open'
    btn.className = 'btn-primary'
    btn.dataset.u32Name = 'topbar-open'
    btn.title = '打开 PDF（Ctrl+O）'
    btn.textContent = '打开'
    btn.addEventListener('click', () => this._opt.onOpen())
    return btn
  })()

  private readonly _name = (() => {
    const span = document.createElement('span')
    span.className = 'doc-name'
    span.dataset.u32Name = 'topbar-filename'
    return span
  })()

  private readonly _meta = (() => {
    const span = document.createElement('span')
    span.className = 'doc-meta'
    span.dataset.u32Name = 'topbar-meta'
    return span
  })()

  private readonly _left: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'tb-left'
    div.dataset.u32Name = 'topbar-left'
    const title = document.createElement('div')
    title.className = 'doc-title'
    title.dataset.u32Name = 'topbar-title'
    title.appendChild(this._name)
    title.appendChild(this._meta)
    div.appendChild(this._sidebarBtn)
    div.appendChild(this._openBtn)
    div.appendChild(title)
    return div
  })()

  private readonly _toolButtons: HTMLButtonElement[] = []

  private readonly _center: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'tb-center'
    div.dataset.u32Name = 'topbar-center'
    const tools = document.createElement('div')
    tools.className = 'tools'
    tools.dataset.u32Name = 'tools'
    for (const spec of TOOLS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.id = spec.id
      btn.className = 'tool'
      btn.dataset.u32Name = `tool-${spec.mode}`
      btn.dataset.tool = spec.mode
      btn.title = spec.hint
      btn.setAttribute('aria-label', spec.label)
      btn.setAttribute('aria-pressed', 'false')
      btn.innerHTML = spec.icon
      btn.addEventListener('click', () => this._opt.onToolChange(spec.mode))
      this._toolButtons.push(btn)
      tools.appendChild(btn)
    }
    div.appendChild(tools)
    return div
  })()

  private readonly _pageInput: HTMLInputElement = (() => {
    const input = document.createElement('input')
    input.type = 'text'
    input.inputMode = 'numeric'
    input.id = 'page-input'
    input.dataset.u32Name = 'pager-input'
    input.value = '1'
    input.title = '输入页码后回车跳转'
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      const n = Number(input.value)
      const total = this._opt.totalPages.value
      if (Number.isFinite(n) && n >= 1 && n <= total) this._opt.onGoToPage(Math.round(n))
      input.blur()
    })
    input.addEventListener('blur', () => {
      input.value = String(this._opt.currentPage.value)
    })
    return input
  })()

  private readonly _totalLabel = (() => {
    const span = document.createElement('span')
    span.className = 'total'
    span.dataset.u32Name = 'pager-total'
    span.textContent = '0'
    return span
  })()

  private readonly _prevBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mini-btn'
    btn.dataset.u32Name = 'pager-prev'
    btn.title = '上一页'
    btn.innerHTML = icons.prev
    btn.addEventListener('click', () => this._opt.onGoToPage(this._opt.currentPage.value - 1))
    return btn
  })()

  private readonly _nextBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mini-btn'
    btn.dataset.u32Name = 'pager-next'
    btn.title = '下一页'
    btn.innerHTML = icons.next
    btn.addEventListener('click', () => this._opt.onGoToPage(this._opt.currentPage.value + 1))
    return btn
  })()

  private readonly _zoomOutBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mini-btn'
    btn.dataset.u32Name = 'zoom-out'
    btn.title = '缩小（Ctrl+-）'
    btn.innerHTML = icons.minus
    btn.addEventListener('click', () => this._opt.onZoomOut())
    return btn
  })()

  private readonly _zoomInBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mini-btn'
    btn.dataset.u32Name = 'zoom-in'
    btn.title = '放大（Ctrl+=）'
    btn.innerHTML = icons.plus
    btn.addEventListener('click', () => this._opt.onZoomIn())
    return btn
  })()

  private readonly _zoomLabel: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'zoom-label'
    btn.dataset.u32Name = 'zoom-label'
    btn.title = '适应宽度（Ctrl+0）'
    btn.textContent = '100%'
    btn.addEventListener('click', () => this._opt.onFitWidth())
    return btn
  })()

  private readonly _fitBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mini-btn'
    btn.dataset.u32Name = 'zoom-fit'
    btn.title = '适应宽度（Ctrl+0）'
    btn.innerHTML = icons.fit
    btn.addEventListener('click', () => this._opt.onFitWidth())
    return btn
  })()

  private readonly _right: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'tb-right'
    div.dataset.u32Name = 'topbar-right'

    const pager = document.createElement('div')
    pager.className = 'pager'
    pager.dataset.u32Name = 'pager'
    pager.appendChild(this._prevBtn)
    pager.appendChild(this._pageInput)
    pager.appendChild(this._totalLabel)
    pager.appendChild(this._nextBtn)

    const sep = document.createElement('span')
    sep.className = 'tb-sep'
    sep.dataset.u32Name = 'topbar-sep'

    const zoom = document.createElement('div')
    zoom.className = 'pager'
    zoom.dataset.u32Name = 'zoom'
    zoom.appendChild(this._zoomOutBtn)
    zoom.appendChild(this._zoomLabel)
    zoom.appendChild(this._zoomInBtn)
    zoom.appendChild(this._fitBtn)

    div.appendChild(pager)
    div.appendChild(sep)
    div.appendChild(zoom)
    return div
  })()

  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'topbar'
    div.dataset.u32Name = 'topbar'
    div.appendChild(this._left)
    div.appendChild(this._center)
    div.appendChild(this._right)
    return div
  })()

  private _initWatches = (() => {
    const opt = this._opt

    this.dispose(
      watch([opt.fileName.changed], () => {
        this._name.textContent = opt.fileName.value
        this._name.title = opt.fileName.value
      }),
    )

    this.dispose(
      watch([opt.totalPages.changed, opt.annoCount.changed], () => {
        const total = opt.totalPages.value
        const count = opt.annoCount.value
        this._totalLabel.textContent = String(total)
        this._meta.textContent =
          total === 0 ? '' : count > 0 ? `${total} 页 · ${count} 处批注` : `${total} 页`
        if (total === 0) this._pageInput.value = ''
        this._pageInput.disabled = total === 0
        this._prevBtn.disabled = total === 0
        this._nextBtn.disabled = total === 0
        for (const btn of this._toolButtons) btn.disabled = total === 0
        this._zoomOutBtn.disabled = total === 0
        this._zoomInBtn.disabled = total === 0
        this._zoomLabel.disabled = total === 0
        this._fitBtn.disabled = total === 0
      }),
    )

    this.dispose(
      watch([opt.currentPage.changed, opt.totalPages.changed], () => {
        const cur = opt.currentPage.value
        const total = opt.totalPages.value
        if (total === 0) {
          this._pageInput.value = ''
        } else if (document.activeElement !== this._pageInput) {
          this._pageInput.value = String(cur)
        }
        this._prevBtn.disabled = cur <= 1
        this._nextBtn.disabled = total === 0 || cur >= total
      }),
    )

    this.dispose(
      watch([opt.zoom.changed], () => {
        this._zoomLabel.textContent = `${Math.round(opt.zoom.value * 100)}%`
      }),
    )

    this.dispose(
      watch([opt.tool.changed, opt.totalPages.changed], () => {
        const tool = opt.tool.value
        for (const btn of this._toolButtons) {
          btn.setAttribute('aria-pressed', String(btn.dataset.tool === tool))
        }
      }),
    )
  })()
}
