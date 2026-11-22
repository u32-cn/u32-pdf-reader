import { Destroyable, watch } from '@vtxfp/vtxf-basic-tools-202607/browser'
import type { ReactiveVariable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import { PALETTE, type ShapeKind } from './AnnotationStore'
import { icons } from './icons'

export type ToolMode = 'select' | 'highlight' | 'underline' | 'note' | 'text' | 'ink' | 'shape'
export type DrawColor = string

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
  /** 批注显示开关（App 持有状态，顶栏只反映）：pdf=PDF原生外观 / chip=衍生播放按钮 / mine=手动批注 */
  annoPdfHidden: ReactiveVariable<boolean>
  annoChipHidden: ReactiveVariable<boolean>
  annoMineHidden: ReactiveVariable<boolean>
  onToggleAnnoPdf: () => void
  onToggleAnnoChip: () => void
  onToggleAnnoMine: () => void
  /** 绘制工具状态（App 持有真实状态，顶栏只反映） */
  drawColor: ReactiveVariable<DrawColor>
  strokeWidth: ReactiveVariable<number>
  shapeKind: ReactiveVariable<ShapeKind>
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
  { mode: 'ink', id: 'btn-ink', icon: icons.ink, label: '手绘', hint: '手绘（I）· 按住拖动画线' },
  { mode: 'shape', id: 'btn-shape', icon: icons.shape, label: '图形', hint: '图形（G）· 拖拽画矩形/椭圆/直线/箭头' },
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

  private readonly _annoPdfBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'icon-btn'
    btn.dataset.u32Name = 'topbar-anno-pdf-toggle'
    btn.title = '显示/隐藏 PDF 原生注解外观（附件图钉、声音喇叭）'
    btn.innerHTML = icons.highlight
    btn.setAttribute('aria-pressed', 'false')
    btn.addEventListener('click', () => this._opt.onToggleAnnoPdf())
    return btn
  })()

  private readonly _annoChipBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'icon-btn'
    btn.dataset.u32Name = 'topbar-anno-chip-toggle'
    btn.title = '显示/隐藏音频播放按钮（按注解位置生成的播放入口）'
    btn.innerHTML = icons.play
    btn.setAttribute('aria-pressed', 'false')
    btn.addEventListener('click', () => this._opt.onToggleAnnoChip())
    return btn
  })()

  private readonly _annoMineBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'icon-btn'
    btn.dataset.u32Name = 'topbar-anno-mine-toggle'
    btn.title = '显示/隐藏手动批注（便签、文字、手绘、图形）'
    btn.innerHTML = icons.note
    btn.setAttribute('aria-pressed', 'false')
    btn.addEventListener('click', () => this._opt.onToggleAnnoMine())
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
    div.appendChild(this._annoPdfBtn)
    div.appendChild(this._annoChipBtn)
    div.appendChild(this._annoMineBtn)
    return div
  })()

  private readonly _toolButtons: HTMLButtonElement[] = []

  /** 绘制选项条：调色板 + 线宽 +（shape 时）形状切换 */
  private readonly _drawBar: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'draw-bar'
    div.dataset.u32Name = 'draw-bar'
    div.hidden = true
    return div
  })()

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
    const wrap = document.createElement('div')
    wrap.className = 'tb-center-wrap'
    wrap.dataset.u32Name = 'topbar-center-wrap'
    wrap.appendChild(tools)
    wrap.appendChild(this._drawBar)
    div.appendChild(wrap)
    return div
  })()

  /** 构建/刷新绘制选项条内容 */
  private _buildDrawBar() {
    const bar = this._drawBar
    bar.replaceChildren()
    const tool = this._opt.tool.value
    if (tool !== 'ink' && tool !== 'shape') return

    // 调色板
    const palette = document.createElement('div')
    palette.className = 'db-group'
    palette.dataset.u32Name = 'draw-palette'
    for (const c of PALETTE) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'db-swatch'
      b.dataset.u32Name = 'draw-color'
      b.dataset.color = c
      b.title = '画笔颜色'
      b.style.background = c
      b.addEventListener('click', () => {
        this._opt.drawColor.value = c
        this._syncDrawBar()
      })
      palette.appendChild(b)
    }
    bar.appendChild(palette)

    // 线宽
    const widths = document.createElement('div')
    widths.className = 'db-group'
    widths.dataset.u32Name = 'draw-widths'
    for (const w of [2, 4, 7]) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'db-width'
      b.dataset.u32Name = `draw-width-${w}`
      b.dataset.width = String(w)
      b.title = `线宽 ${w}`
      b.setAttribute('aria-label', `线宽 ${w}`)
      const dot = document.createElement('i')
      dot.style.width = dot.style.height = `${w}px`
      b.appendChild(dot)
      b.addEventListener('click', () => {
        this._opt.strokeWidth.value = w
        this._syncDrawBar()
      })
      widths.appendChild(b)
    }
    bar.appendChild(widths)

    // 形状（仅 shape 工具）
    if (tool === 'shape') {
      const shapes = document.createElement('div')
      shapes.className = 'db-group'
      shapes.dataset.u32Name = 'draw-shapes'
      const kinds: Array<{ k: ShapeKind; svg: string; label: string }> = [
        { k: 'rect', svg: icons.shapeRect, label: '矩形' },
        { k: 'ellipse', svg: icons.shapeEllipse, label: '椭圆' },
        { k: 'line', svg: icons.shapeLine, label: '直线' },
        { k: 'arrow', svg: icons.shapeArrow, label: '箭头' },
      ]
      for (const s of kinds) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'db-shape'
        b.dataset.u32Name = `draw-shape-${s.k}`
        b.dataset.kind = s.k
        b.title = s.label
        b.setAttribute('aria-label', s.label)
        b.innerHTML = s.svg
        b.addEventListener('click', () => {
          this._opt.shapeKind.value = s.k
          this._syncDrawBar()
        })
        shapes.appendChild(b)
      }
      bar.appendChild(shapes)
    }
    this._syncDrawBar()
  }

  private _syncDrawBar() {
    const color = this._opt.drawColor.value
    const width = this._opt.strokeWidth.value
    const kind = this._opt.shapeKind.value
    for (const b of this._drawBar.querySelectorAll<HTMLButtonElement>('[data-u32-name="draw-color"]')) {
      b.setAttribute('aria-pressed', String(b.dataset.color === color))
    }
    for (const b of this._drawBar.querySelectorAll<HTMLButtonElement>('[data-u32-name^="draw-width-"]')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.width) === width))
    }
    for (const b of this._drawBar.querySelectorAll<HTMLButtonElement>('[data-u32-name^="draw-shape-"]')) {
      b.setAttribute('aria-pressed', String(b.dataset.kind === kind))
    }
  }

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
        this._buildDrawBar()
        this._drawBar.hidden = tool !== 'ink' && tool !== 'shape'
      }),
    )

    this.dispose(
      watch([opt.annoPdfHidden.changed, opt.annoChipHidden.changed, opt.annoMineHidden.changed], () => {
        this._annoPdfBtn.setAttribute('aria-pressed', String(opt.annoPdfHidden.value))
        this._annoChipBtn.setAttribute('aria-pressed', String(opt.annoChipHidden.value))
        this._annoMineBtn.setAttribute('aria-pressed', String(opt.annoMineHidden.value))
      }),
    )

    this.dispose(
      watch([opt.drawColor.changed, opt.strokeWidth.changed, opt.shapeKind.changed], () => {
        this._syncDrawBar()
      }),
    )
  })()
}
