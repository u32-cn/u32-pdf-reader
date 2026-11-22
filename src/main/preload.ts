import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  openPdfDialog: () => ipcRenderer.invoke('open-pdf-dialog'),
  readPdf: (filePath: string) => ipcRenderer.invoke('read-pdf', filePath),
  readAnnotations: (pdfPath: string) => ipcRenderer.invoke('read-annotations', pdfPath),
  writeAnnotations: (pdfPath: string, data: unknown) =>
    ipcRenderer.invoke('write-annotations', pdfPath, data),
})
