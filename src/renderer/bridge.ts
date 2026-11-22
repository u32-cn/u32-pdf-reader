export interface Bridge {
  openPdfDialog(): Promise<string | null>
  readPdf(filePath: string): Promise<ArrayBuffer>
  readAnnotations(pdfPath: string): Promise<unknown>
  writeAnnotations(pdfPath: string, data: unknown): Promise<boolean>
}

declare global {
  interface Window {
    bridge: Bridge
  }
}
