# u32-pdf-reader 安装与校验（给 AI 工具的安装流程）

> 官网 <https://u32-pdf-reader.u32.cn/> · 仓库 <https://github.com/u32-cn/u32-pdf-reader>（仅源码与后端托管）

## 安装步骤

1. 读版本元数据（最新版号、文件名、路径、sha256、字节数都在里面）：

   ```
   https://u32-pdf-reader.u32.cn/data/win/latest.yml
   ```

2. 用 `version` 确认版本，取 `path`（形如 `download/win/u32-pdf-reader-setup-0.2.0.exe`），拼到自建域根，得到下载直链：

   ```
   https://u32-pdf-reader.u32.cn/<path>
   ```

   等价写法：`https://u32-pdf-reader.u32.cn/download/win/<latest.yml 的 files[0].url>`。不要直连 GitHub Releases；它只是兜底源。

3. 校验完整性：下载后计算文件的 SHA-256，与 latest.yml 里的 `sha256` 比对，一致才算下载成功（`size` 字节数可一并核对）。

4. 运行安装包：NSIS 向导式安装（非静默），可选安装目录；装完自动创建「u32 PDF 阅读器」快捷方式并关联 `.pdf` 文件。

## 注意

- 平台：Windows 10 / 11 x64；无 macOS / Linux 版
- 全本地运行：不联网、不上传、不写回原 PDF
- 批注存在 PDF 同目录的 `<同名>.annotations.json`，换机迁移要连这个文件一起拷
- 版本号以 latest.yml 的 `version` 为准；自建域不可用时才走 <https://github.com/u32-cn/u32-pdf-reader/releases> 兜底，并同样做 sha256 校验
- 本页地址是自建域；GitHub Pages 镜像为 <https://u32-cn.github.io/u32-pdf-reader/>，元数据内容一致
