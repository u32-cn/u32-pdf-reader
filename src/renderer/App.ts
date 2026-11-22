import * as pdfjsLib from 'pdfjs-dist'
import { AudioBar } from './AudioBar'
import { AnnotationLayer, type AnnotationRecord } from './AnnotationLayer'
import { collectEmbeddedAudios, type EmbeddedAudio } from './audioExtract'
import './pdf-worker'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const CSS_PREFIX = 'u32--app--root--1763799200000'

class PdfReaderApp {
  private _pdf: pdfjsLib.PDFDocumentProxy | null = null
  private _pdfPath: string | null = null
  private _audioBar = new AudioBar()
  private _annoLayers: AnnotationLayer[] = []
  private _savedRecords: AnnotationRecord[] = []
  private _pendingNote: 'idle' | 'armed' = 'idle'

  private _viewer = document.querySelector('[data-u32-name="viewer"]') as HTMLDivElement
  private _sidebar = document.querySelector('[data-u32-name="sidebar"]') as HTMLDivElement

  private _init = (() => {
    document.getElementById('app')!.appendChild(this._audioBar.root)
    document.getElementById('btn-open')!.addEventListener('click', () => this._openFile())
    document.getElementById('btn-highlight')!.addEventListener('click', () => this._applySelection('highlight'))
    document.getElementById('btn-underline')!.addEventListener('click', () => this._applySelection('underline'))
    document.getElementById('btn-note')!.addEventListener('click', () => {
      this._pendingNote = this._pendingNote === 'armed' ? 'idle' : 'armed'
      this._setNoteCursor()
    })
  })()

  /** 测试钩子：E2E 用（生产无副作用） */
  readonly testHooks = {
    openPath: (p: string) => this._openPath(p),
  }

  private async _openFile() {
    const path = await window.bridge.openPdfDialog()
    if (!path) return
    await this._openPath(path)
  }

  private async _openPath(path: string) {
    this._pdfPath = path
    const bytes = await window.bridge.readPdf(path)
    this._pdf = await pdfjsLib.getDocument({ data: bytes }).promise
    await this._afterOpen(path)
  }

  private async _afterOpen(path: string) {
    const pdf = this._pdf!
    // 清空旧视图

    // 清空旧视图
    this._viewer.innerHTML = ''
    this._sidebar.innerHTML = ''
    this._annoLayers = []
    ;(document.querySelector('[data-u32-name="toolbar-filename"]') as HTMLSpanElement).textContent =
      path.split(/[\\/]/).pop() || ''

    // 读取旁注
    const saved = (await window.bridge.readAnnotations(path)) as AnnotationRecord[] | null
    this._savedRecords = saved ?? []

    // 渲染所有页
    for (let i = 1; i <= pdf.numPages; i++) {
      await this._renderPage(i)
    }
    // 渲染侧栏缩略图
    for (let i = 1; i <= pdf.numPages; i++) {
      this._renderThumbnail(i)
    }

    // 提取内嵌音频并在页面上放播放图标
    const rawBytes = await window.bridge.readPdf(path)
    const audios = await collectEmbeddedAudios(
      new Uint8Array(rawBytes),
      pdf.numPages,
      async (pageNum) => {
        const page = await pdf.getPage(pageNum)
        const annots = await page.getAnnotations()
        // pdf.js annotation 不带对象号，回退：按注解索引近似——v1 用页内 subtype 匹配
        // 真正的对象号从 pdf.js 内部取不到，改用注解 rect 匹配 Sound 注解
        return []
      },
    )
    // 页码归属兜底：sound 注解 rect 无法与 pdf.js 注解对齐时，按对象扫描顺序无从判页
    // 上面 getPageAnnotRefs 拿不到对象号，改为直接扫描页面对象确定 Annots
    this._assignAudioPages(new Uint8Array(rawBytes), audios)
    this._audioIcons = []
    for (const audio of audios) {
      this._audioIcons.push([audio, audio.pageNum])
      this._placeAudioIcon(audio)
    }

    // 启用批注按钮
    for (const id of ['btn-highlight', 'btn-underline', 'btn-note']) {
      (document.getElementById(id) as HTMLButtonElement).disabled = false
    }
  }

  private async _renderPage(pageNum: number) {
    const page = await this._pdf!.getPage(pageNum)
    const baseViewport = page.getViewport({ scale: 1 })
    // 适配可视宽度
    const wrap = document.querySelector('[data-u32-name="viewer-wrap"]') as HTMLDivElement
    const scale = Math.min((wrap.clientWidth - 32) / baseViewport.width, 2)
    const viewport = page.getViewport({ scale })

    const container = document.createElement('div')
    container.className = 'page-container'
    container.dataset.u32Name = `page-${pageNum}`
    container.style.width = `${viewport.width}px`
    container.style.height = `${viewport.height}px`

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width * devicePixelRatio
    canvas.height = viewport.height * devicePixelRatio
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    container.appendChild(canvas)
    this._viewer.appendChild(container)

    await page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport,
      transform: devicePixelRatio !== 1 ? [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] : undefined,
    }).promise

    // 批注层
    const layer = new AnnotationLayer(pageNum)
    layer.root.className = 'annotation-layer'
    layer.root.dataset.u32Name = `annotation-layer-${pageNum}`
    layer.root.classList.add('annotation-layer')
    container.appendChild(layer.root)
    this._annoLayers.push(layer)
    layer.restore(this._savedRecords)

    // 便签：点击空白处
    layer.root.addEventListener('click', (e) => {
      if (this._pendingNote !== 'armed') return
      const rect = container.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      const text = prompt('便签内容：')
      if (text) {
        layer.addNote(x, y, text)
        this._saveAnnotations()
      }
      this._pendingNote = 'idle'
      this._setNoteCursor()
    })

    // 音频图标持久化位置（重开 PDF 时重建）
    if (this._audioIcons) {
      for (const [audio, parentPage] of this._audioIcons) {
        if (parentPage === pageNum) this._placeAudioIcon(audio)
      }
    }
  }

  /** 音频图标记录 [audio, pageNum]，供页面重渲染时恢复 */
  private _audioIcons: [EmbeddedAudio, number][] | null = null

  /** 解析每个页面对象的 /Annots 引用，把 Sound 注解归属到页码 */
  private _assignAudioPages(data: Uint8Array, audios: EmbeddedAudio[]) {
    if (audios.length === 0) return
    const latin = new TextDecoder('latin1').decode(data)
    // 页面对象：/Type /Page ... /Annots [n 0 R ...]
    const pageRe = /\/Type\s*\/Page\b[^>]*?\/Annots\s*\[([^\]]*)\]/g
    const annotToPage = new Map<number, number>()
    let m: RegExpExecArray | null
    let pageNumGuess = 1
    while ((m = pageRe.exec(latin)) !== null) {
      const refRe = /(\d+)\s+0\s+R/g
      let r: RegExpExecArray | null
      while ((r = refRe.exec(m[1])) !== null) {
        annotToPage.set(Number(r[1]), pageNumGuess)
      }
      pageNumGuess++
    }
    // Sound 注解的对象号 → 音频条目按扫描顺序对齐（audioExtract 内部同样顺序）
    const soundRe = /(\d+)\s+0\s+obj[\s\S]{0,400}?\/Subtype\s*\/Sound\b/g
    const soundNums: number[] = []
    let s: RegExpExecArray | null
    while ((s = soundRe.exec(latin)) !== null) soundNums.push(Number(s[1]))
    audios.forEach((audio, i) => {
      const annotNum = soundNums[i]
      if (annotNum != null && annotToPage.has(annotNum)) {
        audio.pageNum = annotToPage.get(annotNum)!
      }
    })
  }

  private _placeAudioIcon(audio: EmbeddedAudio) {
    const container = document.querySelector(`[data-u32-name="page-${audio.pageNum}"]`) as HTMLElement
    if (!container) return
    const icon = document.createElement('button')
    icon.className = 'audio-icon'
    icon.dataset.u32Name = 'audio-icon'
    icon.textContent = '🔊'
    icon.title = audio.title
    // rect 是 PDF 坐标（左下原点），需结合页面渲染 viewport 换算
    const [ax1, ay1, ax2, ay2] = audio.rect
    // 查找该页 canvas 得到页面尺寸
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    const pw = canvas?.clientWidth || 612
    const ph = canvas?.clientHeight || 792
    const nx0 = Math.min(ax1, ax2) / 612
    const nx1 = Math.max(ax1, ax2) / 612
    // 页面 PDF 高度未知，用宽高比推：ph / (pw / 612) = PDF 高
    const pdfH = (ph / pw) * 612
    const ny0 = 1 - Math.max(ay1, ay2) / pdfH
    icon.style.left = `${nx0 * 100}%`
    icon.style.top = `${ny0 * 100}%`
    icon.style.width = `${(nx1 - nx0) * 100}%`
    icon.style.minWidth = '28px'
    icon.style.height = '28px'
    icon.addEventListener('click', (e) => {
      e.stopPropagation()
      this._audioBar.play(audio)
    })
    container.appendChild(icon)
  }

  private _renderThumbnail(pageNum: number) {
    void (async () => {
      const page = await this._pdf!.getPage(pageNum)
      const base = page.getViewport({ scale: 1 })
      const scale = 160 / base.width
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.dataset.u32Name = `thumbnail-${pageNum}`
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
      canvas.addEventListener('click', () => {
        document.querySelector(`[data-u32-name="page-${pageNum}"]`)?.scrollIntoView({ behavior: 'smooth' })
      })
      this._sidebar.appendChild(canvas)
    })()
  }

  private _applySelection(type: 'highlight' | 'underline') {
    let applied = false
    for (const layer of this._annoLayers) {
      if (layer.addFromSelection(type)) {
        applied = true
        break
      }
    }
    if (applied) this._saveAnnotations()
  }

  private async _saveAnnotations() {
    if (!this._pdfPath) return
    const all: AnnotationRecord[] = this._annoLayers.flatMap((l) => l.records)
    await window.bridge.writeAnnotations(this._pdfPath, all)
  }

  private _setNoteCursor() {
    const armed = this._pendingNote === 'armed'
    for (const layer of this._annoLayers) {
      layer.root.style.cursor = armed ? 'crosshair' : ''
    }
  }
}

const __appInstance = new PdfReaderApp()
// E2E 测试钩子
;(window as unknown as { __app: PdfReaderApp }).__app = __appInstance
