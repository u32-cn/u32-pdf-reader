import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

ipcMain.handle('open-pdf-dialog', async () => {
  const result = await dialog.showOpenDialog(win!, {
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('read-pdf', async (_e, filePath: string) => {
  const buf = await fs.readFile(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
})

ipcMain.handle('read-annotations', async (_e, pdfPath: string) => {
  const annoPath = pdfPath.replace(/\.pdf$/i, '.annotations.json')
  try {
    const text = await fs.readFile(annoPath, 'utf-8')
    return JSON.parse(text)
  } catch {
    return null
  }
})

ipcMain.handle('write-annotations', async (_e, pdfPath: string, data: unknown) => {
  const annoPath = pdfPath.replace(/\.pdf$/i, '.annotations.json')
  await fs.writeFile(annoPath, JSON.stringify(data, null, 2), 'utf-8')
  return true
})
