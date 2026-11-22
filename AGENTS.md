# AGENTS.md

AI agent 行为纪律（事实性内容以 README.md 为准，禁止复制）。

## 环境坑（本机实测）

- **启动 electron 前必须 `unset ELECTRON_RUN_AS_NODE`**：本机全局注入该变量，不 unset 会退化成纯 Node 进程报 `app.whenReady is not a function`
- **electron 下载慢/失败**：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install`；本机 electron 缓存在 `%LOCALAPPDATA%/electron/Cache`
- **node_modules/electron 目录 EBUSY**：多半是残留的后台 `npm install` 进程握着句柄。用 PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 按 CommandLine 找根 npm 进程杀掉，别反复重试安装
- **Shell 文本处理**：本机 Git Bash 缺 grep/sed 等，批量文本操作用 node 脚本，别拼管道

## 执行纪律

- 改代码后先 `npm run typecheck` 再说"完成"
- E2E 验证走 `scripts/e2e-verify*.mjs`（需 electron 加 `--remote-debugging-port`），声称"测试通过"必须附 PASS 输出
- `dist/`、`test/` 产物不入库（.gitignore 已覆盖）；测试样本用 `scripts/make-sample.mjs` 随时重新生成，不要手工造二进制文件入库
- 主进程改动（src/main/）需重新 `npm run build:main` 才对 dev 生效（esbuild 非 watch）
