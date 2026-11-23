# AGENTS.md

给 AI agent（和未来的自己）的工作纪律。**产品事实、命令、架构以 `README.md` 为准，这里只写「怎么干、别踩什么」，不复制 README 内容。**
新增功能事实写进 README，新增坑和约束写进这里。

## 完成标准（DoD）

1. `npm run typecheck` 零错误 —— 没跑过不许说「完成」
2. 改渲染层 / 交互 → 跑 `scripts/e2e-verify.mjs`，附 20 项 PASS 输出；禁止用「应该没问题」代替
3. 改 `src/main/` → `npm run build:main`（esbuild 非 watch），再 `npm run dev` 实测窗口起来
4. 改 `package.json` 的 `build` 字段或 `scripts/dist-app.mjs` → **真出一次包**并启动产物验证，别只看脚本输出

## 验证命令

```bash
node scripts/make-sample.mjs test      # 生成带 Sound 注解的样本 PDF（内嵌 440Hz WAV）
node scripts/e2e-verify.mjs            # 开发版 E2E：需 vite 5173 + electron --remote-debugging-port=9222
node scripts/e2e-verify-packaged.mjs   # 打包版 E2E：端口 9223
```

手动排查用 CDP：`.vtxf-ai-work/temp/cdp.mjs`（本地脚本，不入库），支持 `eval` / `shot`。

## 架构边界（改哪、不改哪）

- `App.ts` 只做**装配与编排**（打开文档 / 工具切换 / 批注增删 / 键盘拖拽），不画 DOM
- `Viewer.ts` 管滚动容器、懒渲染、当前页、缩放；`PageView.ts` 管单页三层（canvas / textLayer / annotationLayer + 音频图标）
- **状态只有 `AnnotationStore` 一处**；视图 `watch` store 或自身 `react` 变量，各自改自己的 DOM，业务逻辑只写状态
- 新组件必须 `extends Destroyable`：事件监听、IntersectionObserver、定时器、Blob URL 全在 `this.dispose(...)` 里回收
- 每个元素挂 `data-u32-name`（E2E 与调试靠它定位），顶栏/侧栏状态用 `data-tool` / `data-sidebar` 等属性表达，别用内联 style 切换

## 硬红线

- **禁止用 `window.prompt` / `alert` / `confirm` 收输入**：Electron 已移除 `prompt`，调用即抛错（E2E 里有专门的断言）
- **不写回原 PDF**：批注只落 `<同名>.annotations.json`，保持原件只读
- **不做 612×792 页宽假设**：坐标统一走 `page.getViewport()` / `convertToViewportPoint`，落盘一律归一化
- **颜色、间距、圆角只写 `styles/tokens.css` 里的变量**，组件 CSS 不出现字面色值（换肤 = 换 token）
- 不引 UI 框架、不引外部字体 / 图标 CDN（图标在 `icons.ts`，内联 SVG）
- 不改 `.gitignore` 放行产物（`dist/`、`out/`、`release/`、`.vtxf-ai-work/`、`*.annotations.json`）

## 渲染管线易错点（都是踩过的）

- **缩放滚动还原用「页锚定」不用 scrollHeight 比例**：记录视口顶压住的页号 + 页内偏移比例，重建后滚回同一页同一相对位置；比例还原在长文档缩放后必跳页
- **弹窗类浮层（NotePopover 等）挂在 `.page-shell` 内**：页面缩放重建会连 DOM 一起替换，close 时 `root.remove()`、open 时无条件重新 append，别依赖旧挂载点存活
- **文本层**：容器必须 `position:absolute; inset:0`，且父级设 `--scale-factor`；否则选区永远为空 → 高亮 / 下划线「看起来能用其实不能」
- **主动渲染当前页**：`setDocument` / `rebuild` 结尾直接 render 当前页，别等 IntersectionObserver（E2E 会判定「没画」）
- **适配宽度用 `getBoundingClientRect().width`**，不用 `clientWidth`：滚动条出现会让它跳 10px → 无谓重建 → 测试选中文字时 DOM 被换掉
- **缩放会替换页面 DOM**：`onRebuilt` 里用 `audiosOf(pageNum).indexOf(audio)` 找回新 chip 重新 `open()`；音源对象不变，播放才不中断
- **Blob URL**：销毁时 `revokeObjectURL(存下来的 url)`，不要读 `el.src`（`removeAttribute` 后是空串）
- **音频页码/矩形**：用 `page.getAnnotations()` 的 id（形如 `"12R"` = 对象号）与自研扫描器对齐，别用正则猜页码
- **懒渲染阈值**：近处 700px 渲染、远处 2600px 释放位图；常驻 canvas 应 ≤2，打开 60 页文档应在百毫秒级
- 放播放条 / 弹窗的定位要 clamp 在 `.page-shell` 内，靠右缘向左展开、靠底部翻到上方

## 环境坑（本机实测）

- **手动起 electron 调试必须带 `VITE_DEV_SERVER_URL=http://localhost:5173/`**：不带就静默回退加载 `dist/renderer/` 旧产物，症状是「改了渲染层代码但行为不变」。用 `window.__app.<组件>.<方法>.toString()` 查浏览器里实际加载的源码可以快速定位。vite 进程死后 electron 也会这样回退
- **启动 electron 前必须 `unset ELECTRON_RUN_AS_NODE`**：本机全局注入该变量，不 unset 会退化成纯 Node 进程报 `app.whenReady is not a function`
- **electron 下载慢/失败**：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install`；缓存在 `%LOCALAPPDATA%/electron/Cache`
- **`node_modules/electron` EBUSY**：多半是残留的后台 `npm install` 握着句柄。用 PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 按 CommandLine 找根 npm 进程杀掉，别反复重试安装
- **Shell 文本处理残缺**：本机 Git Bash 缺 `grep/sed/head/tr/wc`（Exit 127）。批量文本操作用 node 或托管目录下的 python 绝对路径写小脚本，别拼管道
- **PowerShell `Remove-Item` 被 safe-delete 包装**（trash 失败即拒绝）：删大目录用 `cmd /c rmdir /s /q`
- **`app.asar` 句柄被后台索引长期占用**：打包必须走 `scripts/dist-app.mjs`（先打系统临时目录再搬回 `out/`），不要直接调 `electron-builder`；搬回时旧目录被占会自动改写带时间戳的新目录（如 `out/portable-<时间>/`）
- **目录规范（只有两个）**：`dist/` = vite/esbuild 中间产物（打包原料，不用看）；`out/` = electron-builder 最终输出，**exe 只在这里找**。不产生 `release/`（旧配置残留，已删）。`out/` 内 `portable-<时间>/u32-pdf-reader.exe` 是最新绿色版，旧的带时间戳目录 + `win-unpacked`/`portable` 是句柄占用删不掉的残留，重启 WorkBuddy 后手动清
- **electron-builder 的 `publish` 必须显式 `null`**（`win.publish` / `nsis.publish` 都要），否则 `computeChannelNames` 读 `null.channel` 直接 exit 1
- **`out/` 必须与 vite 的 `dist/` 分离**（`build.directories.output = "out"`），`files` 精确列举 `dist/main`、`dist/renderer`、`package.json`，否则 asar 会把整个 `node_modules` 吞进去（300MB+、exe 186MB）

## 测试注意

- 两个 e2e 脚本的样本 PDF 路径都按**脚本自身位置**解析（`new URL('../test/sample_audio.pdf', import.meta.url)`），换机器 / 换目录不用改
- 测试钩子 `window.__app.testHooks.openPath(path)` 可跳过系统文件对话框
- E2E 开头会删掉 `test/sample_audio.annotations.json` 以保证批注计数可判定；`*.annotations.json` 已 gitignore
- 断言要看**行为**（选区产生 rect、播放条 top ≥ chip bottom 且在 `.page-shell` 内），不要断言实现细节的选择器层级

## 提交纪律

- 提交信息用中文，格式 `vX.Y.Z: 一句话` 或 `fix: ...` / `feat: ...` / `docs: ...`；一次提交一件事
- 提交前 `git status` 确认没有把 `out/`、`dist/`、`.vtxf-ai-work/`、`*.annotations.json` 带进去
- `test/sample_audio.pdf`、`test/sample_audio.wav` 是**入库样本**，用 `scripts/make-sample.mjs` 重新生成，不要手工塞二进制
- `build/icon.ico` 必须入库（electron-builder 打包依赖它），`build/icon.png` 是生成源
- 设计决策与历史坑的详细记录在 `.workbuddy/memory/`（不入库），长期有效的结论要回写到这里

## 主页发布（AI 必读）

- 仓库在 **GitHub 组织 `u32-cn`**：<https://github.com/u32-cn/u32-pdf-reader>，不在个人账号 `vtxf` 下
- 站点：<https://u32-cn.github.io/u32-pdf-reader/>，Pages 源 = **main 分支 `/docs`**（legacy build），`docs/.nojekyll` 必须保留
- **不要发布到 u32.cn / 专题网页仓库 ai-pages-2026**：那是另一套体系，本产品不占它的路径
- `docs/index.html` 里的 ai-llms-hint 与 canonical / og:url 必须是 `https://u32-cn.github.io/u32-pdf-reader/...`，改域名时四处一起改
- 推送到 GitHub 若 HTTPS 被 `Connection was reset`，改用 SSH 远端（`git@github.com:u32-cn/u32-pdf-reader.git`），本机 SSH 可通

## 下载与发版（AI 必读）

- 安装包唯一真源 = GitHub Releases：`https://github.com/u32-cn/u32-pdf-reader/releases/latest/download/<文件名>`，`latest` 自动指最新版，发版不要改主页 URL
- 元数据 `docs/data/win/latest.yml` 放 Pages（version/path/files[].url/size/sha256），`installation.md` 与 `llms.txt` 里的安装指引都从它读；AI 安装标准入口 = `https://u32-cn.github.io/u32-pdf-reader/installation.md`（注意没有 `docs/` 前缀，Pages 的 /docs 是源不是 URL）
- GitHub Releases 下载直链用 **GET** 测（返回 206）；`curl -I` HEAD 会返回 404，是 GitHub 特性，别误判为链接坏
- 发版流程：`npm run dist` 出 `out/u32-pdf-reader-<ver>-setup.exe` → `gh release create v<ver>` 并上传 → 更新 latest.yml 的 version/url/size/sha256 → 主页按钮版本号 → git commit/push → 等 Pages built
- **不要用 GitHub Pages 的 `/download/` 路径**：Pages 不伺服它（404），也不需要给下载配 EdgeOne 自定义域（u32-pdf-reader.u32.cn 曾卡 process 无法上线已弃用，规则/DNS 已删，加速域名待 online 后清）
