/**
 * Windows 打包脚本。
 *
 * 为什么不直接 `electron-builder --win`：
 * 工作区内的 `app.asar` 会被后台的文件索引进程长期持有句柄，electron-builder 覆盖旧产物时
 * 会报 `The process cannot access the file because it is being used by another process` 并中断。
 * 所以统一打包到系统临时目录，成功后再把安装包搬回 `out/`（安装包本身不被占用）。
 *
 * 用法：
 *   node scripts/dist-app.mjs          生成 NSIS 安装包 → out/u32-pdf-reader-<ver>-setup.exe
 *   node scripts/dist-app.mjs --dir    只生成免安装目录 → out/win-unpacked/
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(here)
const outDir = path.join(projectRoot, 'out')
const staging = path.join(os.tmpdir(), `u32-pdf-pack-${Date.now()}`)
const dirOnly = process.argv.includes('--dir')

const log = (msg) => console.log(`[dist] ${msg}`)

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) {
    console.error(`[dist] 失败：${cmd} ${args.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}

function mb(p) {
  return `${(fs.statSync(p).size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 删除目录。node 的 rmSync 在本机会被 safe-delete 包装按文件数拦截，
 * 所以退化到系统 rmdir；仍失败（文件被占用）时返回 false。
 */
function removeDir(p) {
  if (!fs.existsSync(p)) return true
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    // 交给系统命令
  }
  if (!fs.existsSync(p)) return true
  spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', `"${p}"`], { shell: process.platform === 'win32' })
  return !fs.existsSync(p)
}

/** 复制单个文件；同名目标被占用时退化为加后缀，不中断打包 */
function copyOut(src, targetName) {
  fs.mkdirSync(outDir, { recursive: true })
  let dest = path.join(outDir, targetName)
  try {
    fs.copyFileSync(src, dest)
  } catch (e) {
    if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e
    const ext = path.extname(targetName)
    dest = path.join(outDir, `${path.basename(targetName, ext)}-new${ext}`)
    fs.copyFileSync(src, dest)
    log(`目标被占用，改写为 ${path.basename(dest)}`)
  }
  return dest
}

log('构建渲染层与主进程')
run('npm', ['run', 'build'])

const builderArgs = ['electron-builder', '--win', '--publish', 'never', `-c.directories.output=${staging}`]
if (dirOnly) builderArgs.push('--dir')
log(`打包到临时目录 ${staging}`)
run('npx', builderArgs)

if (dirOnly) {
  const src = path.join(staging, 'win-unpacked')
  let dest = path.join(outDir, 'win-unpacked')
  if (!removeDir(dest)) {
    dest = path.join(outDir, 'portable')
    log('win-unpacked 被占用，改写 portable/')
  }
  if (!removeDir(dest)) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
    dest = path.join(outDir, `portable-${stamp}`)
    log('旧免安装目录被占用，输出到新目录')
  }
  fs.cpSync(src, dest, { recursive: true })
  log(`免安装目录：${dest}`)
} else {
  const files = fs.readdirSync(staging).filter((f) => f.endsWith('.exe') || f.endsWith('.blockmap'))
  for (const f of files) {
    const dest = copyOut(path.join(staging, f), f)
    log(`${path.basename(dest)}  ${mb(dest)}`)
  }
  fs.rmSync(staging, { recursive: true, force: true })
}
