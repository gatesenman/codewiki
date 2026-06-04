# CodeWiki 安装指南（跨平台）

CodeWiki 是一个跨平台桌面应用 + CLI 工具，用于代码 Wiki 生成、知识图谱、语义检索和精确 Code Agent 影响分析。

## 一键安装（推荐）

> 前置要求：Node.js 18+ 与 git。脚本会自动 clone 仓库 → 安装依赖 → 构建当前平台安装包 → 链接 `codewiki` CLI。

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.ps1 | iex
```

> 提示：上述远程一键命令需要 `install.sh` / `install.ps1` 已在 `main` 分支（合并本 PR 后生效）。在此之前可先 `git clone` 仓库后在目录内运行 `./install.sh` / `./install.ps1`。

## 方式零：下载预构建安装包（无需 Node 环境）

前往 [GitHub Releases](https://github.com/gaosichun888/codewiki/releases) 下载对应平台的安装包：

| 平台 | 产物 | 说明 |
|------|------|------|
| Linux | `CodeWiki-*.AppImage` | 赋予执行权限后直接运行：`chmod +x CodeWiki-*.AppImage && ./CodeWiki-*.AppImage` |
| Linux | `codewiki_*_amd64.deb` | `sudo apt install ./codewiki_*_amd64.deb` |
| Windows | `CodeWiki Setup *.exe` / `CodeWiki *.exe` | 安装版 / 便携版（需在 Windows 上构建） |
| macOS | `CodeWiki-*.dmg` | 需在 macOS 上构建 |

## 方式一：直接安装（Windows，开箱即用）

若你手上有附带的 Windows 安装程序（`release/` 目录）：

- **`CodeWiki Setup 1.0.0.exe`** — 标准安装程序（可选安装目录、创建桌面/开始菜单快捷方式）
- **`CodeWiki 1.0.0.exe`** — 便携版（无需安装，双击即用）

双击 `CodeWiki Setup 1.0.0.exe` 按提示安装即可。

## 方式二：从源码构建安装程序（Windows / macOS / Linux）

> 前置要求：Node.js 18+（https://nodejs.org/）

### Windows (PowerShell)

```powershell
./install.ps1
```

### macOS / Linux (bash)

```bash
chmod +x install.sh
./install.sh
```

脚本会自动：安装依赖 → 构建应用与 CLI → 调用 electron-builder 生成当前平台安装包 → 链接 `codewiki` CLI。

构建产物输出到 `release/`：

| 平台 | 产物 |
|------|------|
| Windows | `CodeWiki Setup *.exe` (NSIS), `CodeWiki *.exe` (portable) |
| macOS | `CodeWiki-*.dmg`, `CodeWiki-*-mac.zip` (x64 + arm64) |
| Linux | `CodeWiki-*.AppImage`, `codewiki_*_amd64.deb` |

> 说明：macOS 的 `.dmg` 必须在 macOS 上构建；Windows 的 `.exe` 必须在 Windows 上构建（electron-builder 限制）。Linux 产物可在 Linux 上构建。

### 手动构建命令

```bash
npm install
npm run build          # 构建渲染层 + Electron 主进程
npm run build:cli      # 构建 CLI

npm run dist:win       # 仅 Windows 安装包
npm run dist:mac       # 仅 macOS 安装包
npm run dist:linux     # 仅 Linux 安装包
npm run dist:all       # 三端一起（需在对应平台 / 配置交叉编译）
```

## CLI 使用

```bash
codewiki --help                       # 查看全部命令
codewiki index ./my-project           # 索引项目
codewiki serve 3777 -p ./my-project   # 启动服务 + 调用链路日志仪表盘
codewiki logs                         # 查看 CLI/MCP 调用链路日志 + 准确率评分
```

设置环境变量 `DEEPSEEK_API_KEY`（或 `CODEWIKI_API_KEY` / `OPENAI_API_KEY`）后可用 `codewiki wiki-generate` 生成 Wiki。

## 应用图标

图标由 `build/generate-icon.js` 纯 Node 生成（无原生依赖）：

```bash
npm run icon          # 重新生成 build/icon.png
```
