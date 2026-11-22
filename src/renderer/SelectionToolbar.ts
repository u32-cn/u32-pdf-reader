import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'
import { icons } from './icons'

export interface SelectionToolbarOptions {
  onPick: (type: 'highlight' | 'underline') => void
}

class SelectionToolbarBase extends Destroyable {
  constructor(protected _opt: SelectionToolbarOptions) {
    super()
  }
}

/**
 * 选区浮条：一旦有文字被选中就浮在选区上方，
 * 把「先点高亮、再选文字」的两步操作压成一步。
 */
export class SelectionToolbar extends SelectionToolbarBase {
  private readonly _pick = (type: 'highlight' | 'underline', label: string, icon: string) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.u32Name = `sel-${type}`
    btn.innerHTML = `${icon}<span>${label}</span>`
    // 阻止默认行为，避免点击按钮时选区被清掉
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', () => this._opt.onPick(type))
    return btn
  }

  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'sel-toolbar'
    div.dataset.u32Name = 'selection-toolbar'
    div.dataset.open = 'false'
    div.appendChild(this._pick('highlight', '高亮', icons.highlight))
    div.appendChild(this._pick('underline', '下划线', icons.underline))
    return div
  })()

  constructor(opt: SelectionToolbarOptions) {
    super(opt)
    document.body.appendChild(this.root)
    this.dispose(() => this.root.remove())
  }

  get isOpen() {
    return this.root.dataset.open === 'true'
  }

  show(anchor: DOMRect) {
    this.root.dataset.open = 'true'
    const w = this.root.offsetWidth || 150
    const h = this.root.offsetHeight || 30
    const half = w / 2
    const cx = clamp(anchor.left + anchor.width / 2, half + 8, window.innerWidth - half - 8)
    let top = anchor.top - h - 8
    if (top < 8) top = anchor.bottom + 8
    this.root.style.left = `${Math.round(cx - half)}px`
    this.root.style.top = `${Math.round(top)}px`
  }

  hide() {
    if (!this.isOpen) return
    this.root.dataset.open = 'false'
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
