export interface Bridge {
  openPdfDialog(): Promise<string | null>
  readPdf(filePath: string): Promise<ArrayBuffer>
  readAnnotations(pdfPath: string): Promise<unknown>
  writeAnnotations(pdfPath: string, data: unknown): Promise<boolean>
  /** Electron 32+ 需要用 webUtils 把拖进来的 File 还原成本地路径 */
  getPathForFile(file: File): string
  /** 更新窗口标题栏（文件名 - U32 PDF 阅读器） */
  setWindowTitle(title: string): Promise<void>
  /** main 进程转来的打开请求（文件关联双击 / 第二实例 argv） */
  onOpenPdfPath(cb: (path: string) => void): void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

export {}
