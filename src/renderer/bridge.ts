export interface Bridge {
  openPdfDialog(): Promise<string | null>
  readPdf(filePath: string): Promise<ArrayBuffer>
  readAnnotations(pdfPath: string): Promise<unknown>
  writeAnnotations(pdfPath: string, data: unknown): Promise<boolean>
  /** Electron 32+ 需要用 webUtils 把拖进来的 File 还原成本地路径 */
  getPathForFile(file: File): string
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

export {}
