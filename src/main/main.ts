import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'

const APP_TITLE = 'U32 PDF 阅读器'

let win: BrowserWindow | null = null

/** 从 argv 里捞第一个 .pdf 参数（文件关联双击 / 拖到 exe 上） */
function pdfPathFromArgv(argv: string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const a = argv[i]
    if (/\.pdf$/i.test(a) && fsSync.existsSync(a)) return a
  }
  return null
}

function createWindow(openPath?: string) {
  // 阅读器不需要应用菜单栏；不置 null 会显示 Electron 默认英文菜单
  Menu.setApplicationMenu(null)
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: APP_TITLE,
    icon: path.join(__dirname, '../../build/icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 窗口被遮挡/最小化时页面渲染不停摆（pdf.js 渲染依赖定时器，节流会挂起 render promise）
      backgroundThrottling: false,
    },
  })
  // 防止拖拽 PDF 进窗口触发默认导航（渲染层有 drop 处理，这里兜底）
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  if (openPath) {
    win.webContents.once('did-finish-load', () => {
      win?.webContents.send('open-pdf-path', openPath)
    })
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // 第二实例启动：把 argv 里的 pdf 路径转给已有窗口
  app.on('second-instance', (_e, argv) => {
    const p = pdfPathFromArgv(argv)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (p) win.webContents.send('open-pdf-path', p)
    }
  })

  // 打包后双击关联文件启动：argv 带 pdf 路径
  app.whenReady().then(() => {
    const p = pdfPathFromArgv(process.argv)
    createWindow(p ?? undefined)
  })
}

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

ipcMain.handle('set-window-title', (_e, title: string) => {
  if (win) win.setTitle(title)
})
