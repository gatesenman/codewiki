# CodeWiki MCP 服务器

CodeWiki 自带一个独立的 **Model Context Protocol（MCP）** 服务器
（[`server/mcp-server.ts`](../server/mcp-server.ts)），把 CodeWiki 基于本体
（ontology）的代码智能能力开放给任意兼容 MCP 的客户端——Claude Desktop、Cursor、
VS Code、Windsurf、Cline 等。

服务器在启动时会对项目建立索引（实体、关系、TF‑IDF 搜索），并通过标准的 MCP
**stdio** 传输方式提供 **29 个工具**。MCP 服务器本身不需要浏览器、图形界面或外部
服务，也不需要 LLM 密钥。

- [构建](#构建)
- [运行](#运行)
- [环境变量](#环境变量)
- [客户端配置](#客户端配置)
  - [Claude Desktop](#claude-desktop)
  - [Cursor](#cursor)
  - [VS Code](#vs-code)
  - [Windsurf](#windsurf)
  - [Cline / 其他客户端](#cline--其他客户端)
  - [免构建运行（ts-node）](#免构建运行ts-node)
- [可用工具](#可用工具)
- [排错](#排错)

## 快速开始（推荐）：用 CLI 一键生成配置

如果你装了 CLI（`./install-cli.sh`，或 `npm run install:cli`，或 `npm i -g .`），
就**不用手写任何 JSON**。在你要查询的项目目录里运行：

```bash
codewiki init --ide cursor        # 生成 .cursor/mcp.json
codewiki init --ide vscode        # 生成 .vscode/mcp.json
codewiki init --ide claude-code   # 生成 ./.mcp.json
codewiki init --ide all           # 一次性生成所有支持的 IDE 配置
codewiki init --ide cursor --print   # 只预览不写文件
```

`init` 会自动探测内置 MCP server 的绝对路径（优先编译产物
`dist/server/mcp-server.js`，否则回退用 `ts-node` 跑源码），自动填好
`PROJECT_PATH`，并以**合并**方式写入已有配置（不会覆盖你其它的 server）。
同时会写入 `.codewiki/agent-usage.md`（给 code agent 的使用约定）和默认
`.codewikirc`。

支持的 `--ide`：`cursor`、`vscode`、`claude`（Claude Desktop）、
`claude-code`、`windsurf`、`cline`、`codex`、`all`。

随时查看各 IDE 的配置指引：

```bash
codewiki mcp-guide cursor     # 单个 IDE 的说明
codewiki mcp-guide --verify   # 显示如何冒烟测试 server
```

下文是各客户端的手动配置参考。

## 构建

需要 Node.js 18+。

```bash
npm install
npm run build:mcp
```

该命令会通过 [`server/tsconfig.json`](../server/tsconfig.json) 把服务器编译到
**`dist/server/mcp-server.js`**。下面所有客户端配置都指向这个编译产物路径。

## 运行

服务器从环境变量 `PROJECT_PATH` 读取要索引的项目，并通过 stdio（标准输入/输出）
通信。诊断信息写到 stderr：

```bash
PROJECT_PATH=/path/to/your/project node dist/server/mcp-server.js
# stderr:
#   CodeWiki MCP Server: indexing /path/to/your/project...
#   Indexed 354 entities, 120 files.
#   CodeWiki MCP Server running on stdio.
```

通常你不需要手动运行它——MCP 客户端会按下面的配置自动启动它。

## 环境变量

| 变量                 | 必填   | 默认值        | 说明                                                              |
| -------------------- | ------ | ------------- | ----------------------------------------------------------------- |
| `PROJECT_PATH`       | **是** | —             | 要索引的项目的绝对路径。路径不存在时服务器会退出。                |
| `CODEWIKI_LOG_DIR`   | 否     | `~/.codewiki` | 调用日志（`call-log.jsonl`）目录，与 CLI/仪表盘共用。            |
| `CODEWIKI_CONSUMER`  | 否     | `mcp`         | 记录在调用日志里的自由标签，用于区分是哪个客户端发起的调用。      |

## 客户端配置

下面每个示例都要替换：

- `/abs/path/to/codewiki`：你本地 CodeWiki 仓库的绝对路径
  （使服务器路径为 `…/codewiki/dist/server/mcp-server.js`）；
- `/abs/path/to/your/project`：你想查询的目标项目路径。

> 请使用**绝对路径**。MCP 客户端启动服务器时工作目录不确定，相对路径无法解析。

### Claude Desktop

编辑 `claude_desktop_config.json`：

- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows：`%APPDATA%\Claude\claude_desktop_config.json`
- Linux：`~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "codewiki": {
      "command": "node",
      "args": ["/abs/path/to/codewiki/dist/server/mcp-server.js"],
      "env": { "PROJECT_PATH": "/abs/path/to/your/project" }
    }
  }
}
```

重启 Claude Desktop，CodeWiki 的工具会出现在工具（🔨）菜单里。

### Cursor

在项目里创建 `.cursor/mcp.json`（或放在 `~/.cursor/mcp.json` 作为全局服务器）：

```json
{
  "mcpServers": {
    "codewiki": {
      "command": "node",
      "args": ["/abs/path/to/codewiki/dist/server/mcp-server.js"],
      "env": { "PROJECT_PATH": "/abs/path/to/your/project" }
    }
  }
}
```

在 **Cursor Settings → MCP** 中启用。

### VS Code

VS Code（Copilot agent 模式）读取 `.vscode/mcp.json`。注意顶层键是 `servers`：

```json
{
  "servers": {
    "codewiki": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/codewiki/dist/server/mcp-server.js"],
      "env": { "PROJECT_PATH": "${workspaceFolder}" }
    }
  }
}
```

`${workspaceFolder}` 会让服务器索引当前打开的项目。

### Windsurf

编辑 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
    "codewiki": {
      "command": "node",
      "args": ["/abs/path/to/codewiki/dist/server/mcp-server.js"],
      "env": { "PROJECT_PATH": "/abs/path/to/your/project" }
    }
  }
}
```

### Cline / 其他客户端

任何通过 stdio 使用 MCP 的客户端都用同样的结构——`command`（`node`）、`args`
（编译后的服务器路径）、以及带 `PROJECT_PATH` 的 `env`。具体配置文件位置请查阅
你所用客户端的 MCP 设置。

### 免构建运行（ts-node）

如果想跳过构建步骤，可以直接运行 TypeScript 源码：

```json
{
  "mcpServers": {
    "codewiki": {
      "command": "npx",
      "args": ["-y", "ts-node", "/abs/path/to/codewiki/server/mcp-server.ts"],
      "env": { "PROJECT_PATH": "/abs/path/to/your/project" }
    }
  }
}
```

这种方式启动更慢（边运行边编译），首次还需要联网执行 `npx`；日常使用建议用
`npm run build:mcp`。

## 可用工具

按用途分组的全部 29 个工具。

### Wiki 与搜索

| 工具             | 说明 |
| ---------------- | ---- |
| `read_wiki`      | 获取项目结构与关键实体的概览。 |
| `search_code`    | 在整个代码库做语义搜索，按相关性返回代码片段。 |
| `find_references`| 查找符号在代码库中的所有使用点（基于图的引用 + 文本匹配）。 |
| `get_key_symbols`| 用代码图上的 PageRank 对符号按结构重要性排序。 |

### 实体与关系

| 工具              | 说明 |
| ----------------- | ---- |
| `get_entity_info` | 从本体图获取某个代码实体（类、函数、接口）的信息。 |
| `get_relations`   | 获取某个实体的全部入向/出向关系。 |
| `get_dependencies`| 获取某个实体的依赖图。 |
| `explore_symbols` | 返回多个符号的源码（按文件分组）以及它们之间的关系图。 |
| `file_context`    | 获取某个文件内定义的全部符号及其 import/export。 |

### 调用图

| 工具           | 说明 |
| -------------- | ---- |
| `find_callers` | 查找调用某符号的所有实体（可传递，BFS）。 |
| `find_callees` | 查找某符号调用的所有实体（可传递，BFS）。 |
| `trace_path`   | 追踪两个符号之间的调用路径（A 如何经由 calls/uses/imports 到达 B）。 |
| `trace_route`  | 追踪 HTTP 请求从路由 → 处理函数 → 下游调用的流向（Express、Flask/FastAPI、Go net/http）。 |

### 影响分析与安全改动

| 工具                  | 说明 |
| --------------------- | ---- |
| `get_context`         | 智能上下文构建：针对查询返回源码、调用者、被调用者、关系和影响数量。首选上下文工具。 |
| `get_edit_context`    | 改动前打包：源码、调用者（含其源码）、被调用者、相关测试、同级、前向影响、爆炸半径。 |
| `pre_check`           | 改动前综合分析：当前源码、关系、影响范围、同级、警告、风险建议。 |
| `get_impact_analysis` | 分析修改某实体会影响什么。对防止幻觉至关重要。 |
| `blast_radius`        | 反向 BFS 找出所有上游依赖者——该实体变更后会受影响/损坏的一切。 |
| `verify_modification` | 改动后校验：语法错误、被删除的实体、被破坏的依赖。 |
| `detect_changes`      | 把未提交的 git 改动映射到受影响的符号，并做风险分级。 |
| `suggest_tests`       | 给定被修改的实体，建议应运行哪些测试文件（直接 + 传递）。 |

### 架构与代码分析

| 工具                 | 说明 |
| -------------------- | ---- |
| `get_architecture`   | 架构概览：语言、入口点、热点、分层、跨边界依赖。 |
| `analyze_complexity` | 某实体的圈复杂度与耦合度指标。 |
| `find_dead_code`     | 查找无引用的符号（孤立函数、导出但未用、内部未用）。 |
| `detect_communities` | 用连通分量分析把相关符号聚成功能模块，并给出内聚度评分。 |

### 索引管理

| 工具                  | 说明 |
| --------------------- | ---- |
| `health_check`        | 检查服务器健康与配置（项目路径、索引统计、能力）。 |
| `lsif_status`         | 检查是否有 LSIF/SCIP 索引，以及如何生成。 |
| `incremental_reindex` | 只重新索引自上次以来变化的文件。 |
| `full_reindex`        | 强制对整个项目做全量重新索引。 |

## 排错

- **`Error: PROJECT_PATH="" does not exist.`**——`PROJECT_PATH` 没设置或指向了不
  存在的目录。请在客户端的 `env` 中设为绝对路径。
- **客户端看不到 CodeWiki 工具**——确认 `dist/server/mcp-server.js` 存在（先运行
  `npm run build:mcp`），配置里用的是绝对路径，并在改完配置后重启了客户端。
- **`Cannot find module …/dist/server/mcp-server.js`**——还没构建，或路径写错。运行
  `npm run build:mcp` 并核对绝对路径。
- **独立验证服务器**——在终端运行：
  `PROJECT_PATH=/abs/path/to/your/project node dist/server/mcp-server.js`，应能在
  stderr 看到索引信息。按 Ctrl+C 停止。
- **查看调用记录**——每次工具调用都会追加到
  `${CODEWIKI_LOG_DIR:-~/.codewiki}/call-log.jsonl`，可以 tail 它来调试。
