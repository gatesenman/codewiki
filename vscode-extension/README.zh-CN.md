# CodeWiki VS Code 扩展

> **AI 代码知识库** —— 基于本体（ontology）的代码分析、健康检查，以及供 AI 精确理解代码的 MCP 服务。

[English →](./README.md)

## 功能

| 功能 | 说明 |
|---|---|
| **初始化** | 检测/配置 CLI、写入 `.vscode/mcp.json`、验证可用 —— 一个命令搞定一切。 |
| **健康检查** | 代码健康等级（A–F）：循环依赖、死代码、耦合、上帝对象 —— 分页面板展示；等级同时显示在状态栏。 |
| **安全扫描** | 保守规则扫描：硬编码密钥、`eval`、SQL/Shell 注入、不安全 HTML、调试代码、弱随机数、明文 HTTP —— 发现会写入 **问题** 面板（文件内波浪线）。 |
| **快速上手** | 内置中英双语引导（初始化 → 健康检查 → 使用面板），步骤含可直接运行的命令链接。 |
| **模式检测** | Singleton / Factory / Observer / Builder / Strategy / Repository + 反模式（God-Object / High-Coupling）。 |
| **使用面板** | 侧边栏网格按钮，一键调用所有 CodeWiki 功能。 |
| **语义搜索** | 按语义搜索代码，点击跳转。 |
| **修改前预检** | 修改前影响分析 —— 风险等级 + 受影响实体/文件。 |
| **CodeLens** | 在类/函数上方内联显示「预检」链接。 |
| **中英双语** | 完整 EN/中文支持，跟随 VS Code 界面语言或手动设置 `codewiki.language`。 |
| **MCP 集成** | 自动写入 IDE MCP 配置，让 Cursor / Claude / Windsurf 等 code agent 消费 CodeWiki。 |

## 快速开始

1. 安装 `.vsix`（扩展 → … → 从 VSIX 安装）。
2. 打开项目文件夹。
3. 运行 **CodeWiki: 初始化** (`Ctrl+Shift+P` → 输入 "CodeWiki Init")。
   - 检测 CLI → 写入 MCP 配置 → 索引项目 → 验证。
4. 运行 **CodeWiki: 健康检查** 查看代码等级。
5. 点击活动栏中的 📖 图标打开 **使用面板**，一键访问所有功能。

## 前置要求

- **Node.js 18+**
- `codewiki` CLI 可用：
  - 全局安装：在 codewiki 仓库根目录执行 `npm i -g .`，或
  - 保持 `codewiki.cliPath` 为 `npx tsx`，本地需有仓库克隆。

## 设置

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `codewiki.language` | `auto` | 面板界面语言：`auto` / `en` / `zh`。 |
| `codewiki.cliPath` | `npx tsx` | CLI 运行命令或全局可执行名。 |
| `codewiki.autoIndex` | `true` | 扩展激活时自动索引。 |
| `codewiki.codeLens` | `true` | 显示「预检」CodeLens。 |
| `codewiki.llmProvider` | `openai` | LLM 提供方。 |
| `codewiki.apiKey` | — | LLM API Key。 |
| `codewiki.model` | `gpt-4o` | LLM 模型。 |

## 命令

| 命令 | 说明 |
|---|---|
| 初始化 | CLI + MCP + 索引一步到位 |
| 健康检查 | 代码等级面板（健康/安全/模式） |
| 打开使用面板 | 全功能按钮网格 |
| 打开设置 | 跳转扩展设置 |
| 索引项目 | 构建/重建本体 |
| 语义搜索 | 按语义找代码 |
| 向代码提问 | 自然语言→实体 |
| 修改前预检 | 修改前影响 |
| 影响分析 | 完整影响图 |
| 显示关系 | 实体连接 |
| 安全扫描 | 安全发现面板 |
| 模式检测 | 模式/反模式面板 |
| 导出 Wiki | Markdown / HTML / JSON |
| 查看状态 | 索引统计 |
| 刷新 | 重新索引 + 刷新视图 |
| 清除安全问题 | 清除扫描诊断 |

## 快捷键

| 快捷键 | 命令 |
|---|---|
| `Ctrl/Cmd+Alt+S` | 语义搜索 |
| `Ctrl/Cmd+Alt+H` | 健康检查 |
| `Ctrl/Cmd+Alt+P` | 修改前预检（编辑器内） |

## 从源码构建

```bash
cd vscode-extension
npm install
npm run compile       # 类型检查 + 编译
npm run package       # 构建 .vsix
```

## 许可

MIT
