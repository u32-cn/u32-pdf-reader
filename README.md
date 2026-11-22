# u32-pdf-reader

简洁的 Windows 桌面 PDF 阅读器：批注 + 内嵌音频播放。

## 功能

- PDF 渲染：pdf.js，连续滚动 + 侧栏缩略图
- 内嵌音频：解析 Sound 注解，点击页面 🔊 图标播放（进度条可拖拽、倍速 0.5/1/1.25/1.5/2、暂停）
- 批注：高亮 / 下划线 / 便签，存旁注文件 `<同名>.annotations.json`（不写回 PDF）

## 技术栈

Electron + TypeScript + 原生 DOM（无框架）+ Vite + pdfjs-dist + [@vtxfp/vtxf-basic-tools-202607](https://codeup.aliyun.com/vtxf/2026/vtxf-basic-tools-202607)

## 开发

```bash
npm install        # electron 下载慢时: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm run dev        # vite (5173) + electron 开发模式
npm run typecheck  # tsc --noEmit
npm run build      # 主进程 esbuild + 渲染层 vite build
npm run dist       # 打包 NSIS 安装包 + win-unpacked 绿色版 → dist/
```

> Windows 本机若全局有 `ELECTRON_RUN_AS_NODE=1`，启动前必须 `unset`，否则 electron 会退化成纯 Node 进程。

## 打包产物

| 文件 | 说明 |
|---|---|
| `dist/u32-pdf-reader Setup <版本>.exe` | NSIS 安装包 |
| `dist/win-unpacked/u32-pdf-reader.exe` | 免安装绿色版 |

## 测试

```bash
node scripts/make-sample.mjs test   # 生成带 Sound 注解的样本 PDF（内嵌 440Hz WAV）
node scripts/e2e-verify.mjs         # E2E（需先启动 dev + electron --remote-debugging-port=9222）
node scripts/e2e-verify-packaged.mjs # E2E（打包版，端口 9223）
```

E2E 覆盖 10 项：UI 元素 / 打开流程 / 页面渲染 / canvas 内容 / 音频图标 / 播放条出现 / 进度推进 / 倍速 / 暂停 / 批注层。

## 架构

```
src/
├── main/        # Electron 主进程（窗口、IPC：打开文件/读PDF/旁注读写）
│   ├── main.ts
│   └── preload.ts
└── renderer/    # 渲染进程
    ├── App.ts              # 应用入口（页面渲染、缩略图、批注接线）
    ├── audioExtract.ts     # 扫描 PDF 对象提取 Sound 注解音频（FLATE 解压）
    ├── AudioBar.ts         # 播放条（进度/倍速/暂停）
    └── AnnotationLayer.ts  # 批注层（高亮/下划线/便签）
```

- 音频提取不走 pdf.js 注解 API（拿不到原始流），直接扫 PDF 对象：正则找 `N 0 obj` 片段 → 解析 `/Sound` 引用 → 取流（`/Filter /FlateDecode` 时用 `DecompressionStream` 解压）
- 批注存旁注 JSON（归一化坐标 0-1），打开 PDF 时读取重建
