# CodeWiki MCP Server

CodeWiki ships a standalone **Model Context Protocol (MCP)** server
([`server/mcp-server.ts`](../server/mcp-server.ts)) that exposes CodeWiki's
ontology-based code intelligence to any MCP-compatible client — Claude Desktop,
Cursor, VS Code, Windsurf, Cline, etc.

The server indexes a project on startup (entities, relations, TF‑IDF search) and
serves **29 tools** over the standard MCP **stdio** transport. No browser, GUI,
or external service is required, and no LLM key is needed for the MCP server
itself.

- [Build](#build)
- [Run](#run)
- [Environment variables](#environment-variables)
- [Client configuration](#client-configuration)
  - [Claude Desktop](#claude-desktop)
  - [Cursor](#cursor)
  - [VS Code](#vs-code)
  - [Windsurf](#windsurf)
  - [Cline / other clients](#cline--other-clients)
  - [Run without building (ts-node)](#run-without-building-ts-node)
- [Available tools](#available-tools)
- [Troubleshooting](#troubleshooting)

## Quick start (recommended): one-click config with the CLI

If you installed the CLI (`./install-cli.sh`, or `npm run install:cli`, or
`npm i -g .`), you don't have to write any JSON by hand. From inside the project
you want to query, run:

```bash
codewiki init --ide cursor        # writes .cursor/mcp.json
codewiki init --ide vscode        # writes .vscode/mcp.json
codewiki init --ide claude-code   # writes ./.mcp.json
codewiki init --ide all           # writes config for every supported IDE
codewiki init --ide cursor --print   # preview without writing files
```

`init` auto-detects the absolute path of the bundled MCP server (compiled
`dist/server/mcp-server.js`, or `ts-node` on the source as a fallback), fills in
`PROJECT_PATH`, and **merges** into any existing config without clobbering other
servers. It also writes `.codewiki/agent-usage.md` (usage rules for the code
agent) and a default `.codewikirc`.

Supported `--ide` values: `cursor`, `vscode`, `claude` (Claude Desktop),
`claude-code`, `windsurf`, `cline`, `codex`, `all`.

Print per-IDE setup guidance any time:

```bash
codewiki mcp-guide cursor     # instructions for one IDE
codewiki mcp-guide --verify   # show how to smoke-test the server
```

The rest of this document is the manual reference for each client.

## Build

Requires Node.js 18+.

```bash
npm install
npm run build:mcp
```

This compiles the server to **`dist/server/mcp-server.js`** (via
[`server/tsconfig.json`](../server/tsconfig.json)). That compiled path is what
every client config below points to.

## Run

The server reads the target project from the `PROJECT_PATH` environment variable
and communicates over stdio (stdin/stdout). Diagnostics are written to stderr:

```bash
PROJECT_PATH=/path/to/your/project node dist/server/mcp-server.js
# stderr:
#   CodeWiki MCP Server: indexing /path/to/your/project...
#   Indexed 354 entities, 120 files.
#   CodeWiki MCP Server running on stdio.
```

You normally don't run this by hand — an MCP client launches it for you using
the configuration below.

## Environment variables

| Variable             | Required | Default        | Description                                                                 |
| -------------------- | -------- | -------------- | --------------------------------------------------------------------------- |
| `PROJECT_PATH`       | **Yes**  | —              | Absolute path to the project to index. The server exits if it doesn't exist. |
| `CODEWIKI_LOG_DIR`   | No       | `~/.codewiki`  | Directory for the shared call log (`call-log.jsonl`), reused by the CLI/dashboard. |
| `CODEWIKI_CONSUMER`  | No       | `mcp`          | Free-form label recorded in the call log to identify which client made a call. |

## Client configuration

In every example, replace:

- `/abs/path/to/codewiki` with the absolute path to your CodeWiki checkout
  (so the server is `…/codewiki/dist/server/mcp-server.js`), and
- `/abs/path/to/your/project` with the project you want to query.

> Use **absolute paths**. MCP clients launch the server with an unspecified
> working directory, so relative paths will not resolve.

### Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

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

Restart Claude Desktop. The CodeWiki tools appear under the tools (🔨) menu.

### Cursor

Create `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for a global
server):

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

Enable it under **Cursor Settings → MCP**.

### VS Code

VS Code (Copilot agent mode) reads `.vscode/mcp.json`. Note the top-level key is
`servers`:

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

`${workspaceFolder}` makes the server index the currently open project.

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

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

### Cline / other clients

Any client that speaks MCP over stdio works with the same shape — a `command`
(`node`), `args` (the compiled server path), and an `env` with `PROJECT_PATH`.
Consult your client's MCP settings for where its config file lives.

### Run without building (ts-node)

To skip the build step you can run the TypeScript source directly:

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

This is slower to start (compiles on the fly) and requires network access for
`npx` the first time; prefer `npm run build:mcp` for day-to-day use.

## Available tools

All 29 tools, grouped by purpose.

### Wiki & search

| Tool             | Description |
| ---------------- | ----------- |
| `read_wiki`      | Get a summary of the project structure and key entities. |
| `search_code`    | Semantic search across the codebase. Returns relevant code snippets ranked by relevance. |
| `find_references`| Find all usage sites of a symbol across the codebase (graph-based references plus text matches). |
| `get_key_symbols`| Rank symbols by structural importance using PageRank on the code graph. |

### Entities & relations

| Tool              | Description |
| ----------------- | ----------- |
| `get_entity_info` | Get info about a code entity (class, function, interface) from the ontology graph. |
| `get_relations`   | Get all incoming and outgoing relations for a code entity. |
| `get_dependencies`| Get the dependency graph for a code entity. |
| `explore_symbols` | Return source for multiple symbols grouped by file, plus the relationship map between them. |
| `file_context`    | Get all symbols defined in a file plus its imports and exports. |

### Call graph

| Tool           | Description |
| -------------- | ----------- |
| `find_callers` | Find all entities that call a given symbol (transitive, BFS). |
| `find_callees` | Find all entities called by a given symbol (transitive, BFS). |
| `trace_path`   | Trace the call path between two symbols (how A reaches B via calls/uses/imports). |
| `trace_route`  | Trace HTTP request flow from route → handler → downstream calls (Express, Flask/FastAPI, Go net/http). |

### Impact analysis & safe editing

| Tool                  | Description |
| --------------------- | ----------- |
| `get_context`         | Smart context builder: source, callers, callees, relations, and impact count for a query. Primary context tool. |
| `get_edit_context`    | Pre-edit bundle: source, callers (with source), callees, related tests, siblings, forward impact, blast radius. |
| `pre_check`           | Comprehensive pre-modification analysis: current source, relations, impact scope, siblings, warnings, risk recommendation. |
| `get_impact_analysis` | Analyze what would be affected by modifying an entity. Critical for preventing hallucination. |
| `blast_radius`        | Reverse BFS to find all upstream dependents — everything that would break if an entity changes. |
| `verify_modification` | Post-modification check for syntax errors, removed entities, and broken dependencies. |
| `detect_changes`      | Map uncommitted git changes to affected symbols with risk classification. |
| `suggest_tests`       | Given a modified entity, suggest which test files to run (direct and transitive). |

### Architecture & code analysis

| Tool                 | Description |
| -------------------- | ----------- |
| `get_architecture`   | Architecture overview: languages, entry points, hotspots, layers, cross-boundary dependencies. |
| `analyze_complexity` | Cyclomatic complexity and coupling metrics for an entity. |
| `find_dead_code`     | Find unreferenced symbols (orphan functions, exported-but-unused, internal-unused). |
| `detect_communities` | Group related symbols into functional modules via connected-component analysis with cohesion scoring. |

### Index management

| Tool                  | Description |
| --------------------- | ----------- |
| `health_check`        | Check server health and configuration (project path, index stats, capabilities). |
| `lsif_status`         | Check if an LSIF/SCIP index is available and how to generate one. |
| `incremental_reindex` | Reindex only files changed since the last index. |
| `full_reindex`        | Force a full reindex of the entire project. |

## Troubleshooting

- **`Error: PROJECT_PATH="" does not exist.`** — `PROJECT_PATH` is unset or
  points to a non-existent directory. Set it to an absolute path in your client's
  `env` block.
- **Client shows no CodeWiki tools** — Confirm `dist/server/mcp-server.js`
  exists (run `npm run build:mcp`), the path in the config is absolute, and you
  restarted the client after editing its config.
- **`Cannot find module …/dist/server/mcp-server.js`** — You haven't built yet,
  or the path is wrong. Run `npm run build:mcp` and double-check the absolute
  path.
- **Verify the server independently** — Run it from a shell:
  `PROJECT_PATH=/abs/path/to/your/project node dist/server/mcp-server.js`. You
  should see the indexing lines on stderr. Press Ctrl+C to stop.
- **Inspect calls** — Every tool call is appended to
  `${CODEWIKI_LOG_DIR:-~/.codewiki}/call-log.jsonl`, which you can tail to debug.
