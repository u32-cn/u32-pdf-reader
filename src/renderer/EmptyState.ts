import { Destroyable } from '@vtxfp/vtxf-basic-tools-202607/browser'

export interface EmptyStateOptions {
  onOpen: () => void
}

class EmptyStateBase extends Destroyable {
  constructor(protected _opt: EmptyStateOptions) {
    super()
  }
}

/** 首屏空状态：唯一目的是让人知道下一步做什么，不做插画装饰 */
export class EmptyState extends EmptyStateBase {
  private readonly _openBtn: HTMLButtonElement = (() => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn-quiet'
    btn.dataset.u32Name = 'empty-open'
    btn.textContent = '打开 PDF'
    btn.addEventListener('click', () => this._opt.onOpen())
    return btn
  })()

  readonly root: HTMLDivElement = (() => {
    const div = document.createElement('div')
    div.className = 'empty-state'
    div.dataset.u32Name = 'empty-state'

    const art = document.createElement('div')
    art.className = 'empty-art'
    art.dataset.u32Name = 'empty-art'

    const title = document.createElement('h1')
    title.dataset.u32Name = 'empty-title'
    title.textContent = '还没有打开文档'

    const desc = document.createElement('p')
    desc.dataset.u32Name = 'empty-desc'
    desc.innerHTML =
      '把 PDF 拖到这里，或按 <kbd>Ctrl</kbd>+<kbd>O</kbd> 选择文件。打开后可高亮文字、放置便签，点页面上的音频图标即可收听内嵌录音。'

    const actions = document.createElement('div')
    actions.className = 'empty-actions'
    actions.dataset.u32Name = 'empty-actions'
    actions.appendChild(this._openBtn)

    div.appendChild(art)
    div.appendChild(title)
    div.appendChild(desc)
    div.appendChild(actions)
    return div
  })()

  setVisible(visible: boolean) {
    this.root.hidden = !visible
  }
}
