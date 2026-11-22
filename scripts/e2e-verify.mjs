// CDP 端到端验证（UI 重设计后）
// 覆盖：页面/文本层渲染 → 真实选区打高亮 → note 工具（不依赖 prompt）→ 音频浮动播放条
// 用法: node scripts/e2e-verify.mjs
//   前置：vite 开发服务器在 5173，electron 以 --remote-debugging-port=9222 启动
import http from 'node:http'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const PORT = process.env.CDP_PORT || 9222
const PDF_PATH = 'S:/vtxf/vtxf-work/projects/vtxf/u32-pdf-reader-202611/test/sample_audio.pdf'
const ANNO_PATH = PDF_PATH.replace(/\.pdf$/i, '.annotations.json')

// 干净起点：清掉上一轮留下的旁注，批注计数才可判定
try {
  fs.rmSync(ANNO_PATH, { force: true })
} catch {
  /* ignore */
}

function getJson(url) {
  return new Promise((res, rej) => {
    http
      .get(url, (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => res(JSON.parse(d)))
      })
      .on('error', rej)
  })
}

const pages = await getJson(`http://localhost:${PORT}/json`)
const page = pages.find((p) => p.type === 'page')
if (!page) {
  console.error('no page')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.on('message', (m) => {
  const msg = JSON.parse(m)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
await new Promise((r) => ws.on('open', r))

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) {
    throw new Error('eval error: ' + (r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)))
  }
  return r.result?.result?.value
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 轮询等待条件成立（渲染是异步的，不能按下发命令的瞬间判定） */
async function waitFor(expr, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expr)) return true
    await wait(100)
  }
  return false
}

// ── 1. 顶栏结构 ───────────────────────────────────────────────
const uiOk = await evaluate(`(() => {
  const ids = ['btn-open','btn-sidebar','btn-select','btn-highlight','btn-underline','btn-note','btn-text','page-input']
  const missing = ids.filter((id) => !document.getElementById(id))
  return missing.length === 0 ? 'ok' : 'missing:' + missing.join(',')
})()`)
check('顶栏：五工具 + 页码 + 侧栏开关齐全', uiOk === 'ok', uiOk)

// ── 2. 打开文档 ───────────────────────────────────────────────
await evaluate(`window.__app.testHooks.openPath('${PDF_PATH}')`)
check('App 完整打开流程无异常', true, PDF_PATH)

const painted = await waitFor(
  `document.querySelector('.page-shell')?.dataset.rendered === 'true' && document.querySelectorAll('[data-u32-name^="text-layer-"] span').length > 0`,
)
check('首屏页面与文本层就绪', painted)

const pageCount = await evaluate(`document.querySelectorAll('[data-u32-name^="page-"]').length`)
check('PDF 页面壳渲染', pageCount >= 1, pageCount + ' 页')

const canvasPainted = await evaluate(`(() => {
  const c = document.querySelector('.page-shell canvas')
  if (!c) return false
  const ctx = c.getContext('2d')
  const data = ctx.getImageData(0, 0, c.width, Math.min(c.height, 200)).data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 200 && data[i + 1] < 200 && data[i + 2] < 200) return true
  }
  return false
})()`)
check('页面有内容（canvas 非空白）', canvasPainted)

// ── 3. 文本层（v1 缺失，导致高亮不可用）─────────────────────
const textLayer = await evaluate(`(() => {
  const spans = Array.from(document.querySelectorAll('[data-u32-name^="text-layer-"] span'))
  const text = spans.map((s) => s.textContent).join(' ').trim()
  return { count: spans.length, text }
})()`)
check('文本层存在且有文字', textLayer.count >= 1 && textLayer.text.length > 0, `span=${textLayer.count} "${textLayer.text.slice(0, 40)}"`)

// ── 4. 真实选区 → 浮条 ───────────────────────────────────────
// 页面可能因容器尺寸变化重建一次（DOM 被替换会让选区失效），重试到稳定为止
let selOk = { ok: false, bar: 'false', text: '' }
for (let attempt = 0; attempt < 4 && !selOk.ok; attempt++) {
  await wait(300)
  selOk = await evaluate(`(async () => {
    const span = document.querySelector('[data-u32-name^="text-layer-"] span')
    if (!span || !span.firstChild) return { ok: false, bar: 'false', text: '' }
    const range = document.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, Math.min(5, span.textContent.length))
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    await new Promise((r) => setTimeout(r, 250))
    const bar = document.querySelector('[data-u32-name="selection-toolbar"]')
    return { ok: !sel.isCollapsed, bar: bar.dataset.open, text: sel.toString() }
  })()`)
}
check('真实选区成立', selOk.ok === true, `选中 "${selOk.text}"`)
check('选区浮条出现', selOk.bar === 'true')

// ── 5. 高亮落地 ───────────────────────────────────────────────
const hlOk = await evaluate(`(async () => {
  document.querySelector('[data-u32-name="sel-highlight"]').click()
  await new Promise((r) => setTimeout(r, 300))
  const marks = document.querySelectorAll('[data-u32-name="annotation-highlight"]')
  const recs = window.__app._store.records.filter((r) => r.type === 'highlight')
  return { marks: marks.length, recs: recs.length, text: recs[0]?.text || '' }
})()`)
check('高亮 DOM 出现并入库', hlOk.marks >= 1 && hlOk.recs >= 1, `marks=${hlOk.marks} 引文="${hlOk.text}"`)

// ── 6. 便签：不依赖 window.prompt ────────────────────────────
const noteOk = await evaluate(`(async () => {
  window.__promptCalled = false
  window.prompt = () => { window.__promptCalled = true; return 'x' }
  document.querySelector('[data-u32-name="tool-note"]').click()
  const pageEl = document.querySelector('.page-shell')
  const r = pageEl.getBoundingClientRect()
  pageEl.dispatchEvent(new MouseEvent('click', {
    clientX: r.left + r.width * 0.4,
    clientY: r.top + r.height * 0.5,
    bubbles: true,
  }))
  await new Promise((res) => setTimeout(res, 200))
  const pop = document.querySelector('[data-u32-name="note-pop"]')
  const opened = !pop.hidden
  const ta = document.querySelector('[data-u32-name="note-pop-input"]')
  ta.value = 'E2E 便签'
  document.querySelector('[data-u32-name="note-pop-save"]').click()
  await new Promise((res) => setTimeout(res, 300))
  return {
    opened,
    promptCalled: window.__promptCalled,
    pins: document.querySelectorAll('[data-u32-name="annotation-note"]').length,
    text: (window.__app._store.records.find((r) => r.type === 'note') || {}).text,
  }
})()`)
check('便签弹窗就地打开', noteOk.opened === true)
check('便签记录写入（未调用 prompt）', noteOk.pins >= 1 && noteOk.text === 'E2E 便签', `pin=${noteOk.pins} text=${noteOk.text}`)
check('全程未使用 window.prompt', noteOk.promptCalled === false)

// ── 7. 侧栏批注列表跟上 ─────────────────────────────────────
const listOk = await evaluate(`(() => {
  document.querySelector('[data-u32-name="side-tab-anno"]').click()
  return {
    items: document.querySelectorAll('[data-u32-name="anno-item"]').length,
    meta: document.querySelector('[data-u32-name="topbar-meta"]').textContent,
  }
})()`)
check('侧栏批注列表同步', listOk.items >= 2, `条目=${listOk.items} 顶栏="${listOk.meta}"`)

// ── 8. 音频图标 → 浮动播放条 ────────────────────────────────
const iconCount = await evaluate(`document.querySelectorAll('[data-u32-name="audio-icon"]').length`)
check('音频图标就位', iconCount >= 1, iconCount + ' 个')

const bar = await evaluate(`(async () => {
  const chip = document.querySelector('[data-u32-name="audio-icon"]')
  chip.click()
  await new Promise((r) => setTimeout(r, 700))
  const el = document.querySelector('[data-u32-name="audio-bar"]')
  const cr = chip.getBoundingClientRect()
  const br = el.getBoundingClientRect()
  return {
    display: el.style.display,
    parentIsPage: !!el.closest('.page-shell'),
    belowChip: br.top >= cr.bottom - 1,
    overlapsX: br.left < cr.right && br.right > cr.left,
    width: Math.round(br.width),
  }
})()`)
check('点击图标出播放条', bar.display !== 'none')
check('播放条锚定在图标下方（页面内，非固定底栏）', bar.parentIsPage && bar.belowChip && bar.overlapsX, `w=${bar.width}`)

// ── 9. 播放 / 倍速 / 暂停 ───────────────────────────────────
await wait(1200)
const timeText = await evaluate(`document.querySelector('[data-u32-name="audio-bar-time"]').textContent`)
const [cur] = timeText.split('/').map((s) => s.trim())
const curSec = cur.split(':').reduce((a, b) => Number(a) * 60 + Number(b), 0)
check('音频播放中（进度>0）', curSec > 0.1, timeText)

await evaluate(`document.querySelector('[data-u32-name="audio-bar-speed"]').click()`)
const speedText = await evaluate(`document.querySelector('[data-u32-name="audio-bar-speed"]').textContent`)
check('倍速切换', speedText !== '1x', speedText)

await evaluate(`document.querySelector('[data-u32-name="audio-bar-play"]').click()`)
await wait(300)
const pauseText = await evaluate(`document.querySelector('[data-u32-name="audio-bar-play"]').textContent`)
check('暂停切换', pauseText === '▶', pauseText)

// ── 10. 收起播放条 + 截图 ───────────────────────────────────
const closed = await evaluate(`(async () => {
  document.querySelector('[data-u32-name="audio-bar-close"]').click()
  await new Promise((r) => setTimeout(r, 200))
  const el = document.querySelector('[data-u32-name="audio-bar"]')
  const chip = document.querySelector('[data-u32-name="audio-icon"]')
  return { display: el.style.display, pressed: chip.getAttribute('aria-pressed') }
})()`)
check('关闭播放条并复位图标', closed.display === 'none' && closed.pressed === 'false', JSON.stringify(closed))

const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('.vtxf-ai-work/temp/e2e-screenshot.png', Buffer.from(shot.result.data, 'base64'))
console.log('screenshot: .vtxf-ai-work/temp/e2e-screenshot.png')

const failed = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`)
ws.close()
process.exit(failed.length > 0 ? 1 : 0)
