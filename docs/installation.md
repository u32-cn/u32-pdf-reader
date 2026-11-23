# u32-pdf-reader 安装与校验（给 AI 工具的安装流程）

> 官网 <https://u32-cn.github.io/u32-pdf-reader/> · 仓库 <https://github.com/u32-cn/u32-pdf-reader>

## 安装步骤

1. 读版本元数据（最新版号、文件名、sha256、字节数都在里面）：

   ```
   https://u32-cn.github.io/u32-pdf-reader/data/win/latest.yml
   ```

2. 拼下载直链并下载（GitHub Releases 是安装包唯一真源，`latest` 永远指向最新版本）：

   ```
   https://github.com/u32-cn/u32-pdf-reader/releases/latest/download/<latest.yml 里的 url>
   ```

   `<url>` 取 latest.yml `files[0].url`（如 `u32-pdf-reader-0.2.0-setup.exe`），拼到上面直链末尾。用 `latest/download` 而非写死版本号，版本更新后无需改本文档。

3. 校验完整性：下载后计算文件的 SHA-256，与 latest.yml 里的 `sha256` 比对，一致才算下载成功（latest.yml 同时给了 `size` 字节数，可一并核对）。

4. 运行安装包：NSIS 向导式安装（非静默），可选安装目录；装完自动创建「u32 PDF 阅读器」快捷方式并关联 `.pdf` 文件。

## 注意

- 平台：Windows 10 / 11 x64；无 macOS / Linux 版
- 全本地运行：不联网、不上传、不写回原 PDF
- 批注存在 PDF 同目录的 `<同名>.annotations.json`，换机迁移要连这个文件一起拷
- 版本号以 latest.yml 的 `version` 为准；release 列表见 <https://github.com/u32-cn/u32-pdf-reader/releases>
