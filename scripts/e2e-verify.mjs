// CDP 端到端验证：打开 PDF → 页面渲染 → 点击音频图标 → 播放/倍速/暂停
// 用法: node scripts/e2e-verify.mjs（需先启动 vite + electron --remote-debugging-port=9222）
import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))) }).on('error', rej)
  })
}

const pages = await getJson('http://localhost:9222/json')
const page = pages.find((p) => p.type === 'page')
if (!page) { console.error('no page'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
}
ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } })
await new Promise((r) => ws.on('open', r))

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails))
  return r.result?.result?.value
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// 1. UI 元素存在
const uiOk = await evaluate(`(() => {
  const ids = ['btn-open','btn-highlight','btn-underline','btn-note']
  return ids.every(id => !!document.getElementById(id))
})()`)
check('工具栏按钮齐全', uiOk)

// 2. 走 App.testHooks.openPath 完整打开流程
const pdfPath = 'S:/vtxf/vtxf-work/projects/vtxf/u32-pdf-reader-202611/test/sample_audio.pdf'
await evaluate(`window.__app.testHooks.openPath('${pdfPath.replace(/\\/g, '/')}')`)
check('App 完整打开流程无异常', true, pdfPath)

// 3. 页面渲染验证
const pageCount = await evaluate(`document.querySelectorAll('[data-u32-name^="page-"]').length`)
check('PDF 页面渲染', pageCount >= 1, pageCount + ' 页')

const canvasPainted = await evaluate(`(() => {
  const c = document.querySelector('[data-u32-name^="page-"] canvas')
  if (!c) return false
  const ctx = c.getContext('2d')
  const data = ctx.getImageData(0, 0, c.width, Math.min(c.height, 200)).data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 200 && data[i+1] < 200 && data[i+2] < 200) return true
  }
  return false
})()`)
check('页面有内容（canvas 非空白）', canvasPainted)

// 4. 音频图标存在
const iconCount = await evaluate(`document.querySelectorAll('[data-u32-name="audio-icon"]').length`)
check('音频图标就位', iconCount >= 1, iconCount + ' 个')

// 5. 点击图标 → 音频条出现并播放
await evaluate(`document.querySelector('[data-u32-name="audio-icon"]').click()`)
await new Promise((r) => setTimeout(r, 800))
const barVisible = await evaluate(`document.querySelector('[data-u32-name="audio-bar"]').style.display !== 'none'`)
check('点击图标出播放条', barVisible)

// 6. 进度推进（真实播放）
await new Promise((r) => setTimeout(r, 1200))
const timeText = await evaluate(`document.querySelector('[data-u32-name="audio-bar-time"]').textContent`)
const [cur] = timeText.split('/').map((s) => s.trim())
const curSec = cur.split(':').reduce((a, b) => Number(a) * 60 + Number(b), 0)
check('音频播放中（进度>0）', curSec > 0.1, timeText)

// 7. 倍速切换
await evaluate(`document.querySelector('[data-u32-name="audio-bar-speed"]').click()`)
const speedText = await evaluate(`document.querySelector('[data-u32-name="audio-bar-speed"]').textContent`)
check('倍速切换', speedText !== '1x', speedText)

// 8. 暂停
await evaluate(`document.querySelector('[data-u32-name="audio-bar-play"]').click()`)
await new Promise((r) => setTimeout(r, 300))
const pauseText = await evaluate(`document.querySelector('[data-u32-name="audio-bar-play"]').textContent`)
check('暂停切换', pauseText === '▶', pauseText)

// 9. 批注：高亮（模拟选区）
const highlightOk = await evaluate(`(() => {
  const sel = window.getSelection()
  sel.removeAllRanges()
  const container = document.querySelector('[data-u32-name^="annotation-layer-"]')
  const pageEl = container.parentElement
  const range = document.createRange()
  // 在页面容器内造一个文本节点选区
  const textNode = document.createTextNode('sample')
  pageEl.appendChild(textNode)
  range.setStart(textNode, 0)
  range.setEnd(textNode, 6)
  sel.addRange(range)
  return window.__app.testHooks ? 'layer-count:' + document.querySelectorAll('[data-u32-name^="annotation-layer-"]').length : 'no-hooks'
})()`)
check('批注层存在', highlightOk.includes('layer-count:1'), highlightOk)

// 10. 页面渲染截图
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('.vtxf-ai-work/temp/e2e-screenshot.png', Buffer.from(shot.result.data, 'base64'))
console.log('screenshot: .vtxf-ai-work/temp/e2e-screenshot.png')

const failed = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`)
ws.close()
process.exit(failed.length > 0 ? 1 : 0)
