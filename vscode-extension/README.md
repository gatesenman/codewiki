# CodeWiki for VS Code

> **AI Code Knowledge Base** — ontology-based code analysis, health checks, and an MCP server for precise AI code understanding.

[中文文档 →](./README.zh-CN.md)

## Features

| Feature | Description |
|---|---|
| **Initialize** | Detect/configure CLI, write `.vscode/mcp.json`, verify readiness — one command to get everything working. |
| **Health Check** | Code health score (A–F), circular dependencies, dead code, coupling, god objects — shown in a tabbed panel. The grade also appears in the status bar. |
| **Security Scan** | Conservative rule-based scan: hardcoded secrets, `eval`, injection, unsafe HTML, debug, weak random, cleartext HTTP — findings surface in the **Problems** panel (squiggles per file). |
| **Getting Started** | Built-in bilingual walkthrough (Initialize → Health Check → Usage Panel) with runnable command links. |
| **Pattern Detection** | Singleton / Factory / Observer / Builder / Strategy / Repository + anti-patterns (God-Object, High-Coupling). |
| **Usage Panel** | Grid of one-click action buttons in the activity-bar sidebar — the fastest way to access any CodeWiki function. |
| **Semantic Search** | Search code by meaning, jump to results. |
| **Pre-check** | Impact analysis before modifications — risk level + affected entities/files. |
| **CodeLens** | Inline "Pre-check" links above classes/functions. |
| **Bilingual** | Full EN/中文 support — follows VS Code display language or use `codewiki.language`. |
| **MCP Integration** | Writes IDE MCP config so any code agent (Cursor / Claude / Windsurf) can consume CodeWiki. |

## Quick Start

1. Install the `.vsix` (**Extensions → … → Install from VSIX**).
2. Open a project folder.
3. Run **CodeWiki: Initialize** (`Ctrl+Shift+P` → type "CodeWiki Init").
   - Detects CLI, writes MCP config, indexes the project, verifies.
4. Run **CodeWiki: Health Check** to see the code grade.
5. Open the **Usage Panel** in the activity bar (book icon) for one-click access to everything.

## Requirements

- **Node.js 18+**
- The `codewiki` CLI must be available. Either:
  - Install globally from the repo: `npm i -g .` (in the codewiki repo root), or
  - Keep `codewiki.cliPath` set to `npx tsx` and have the repo cloned locally.

## Settings

| Setting | Default | Description |
|---|---|---|
| `codewiki.language` | `auto` | UI language: `auto` / `en` / `zh`. |
| `codewiki.cliPath` | `npx tsx` | CLI runner command or global binary name. |
| `codewiki.autoIndex` | `true` | Auto-index workspace on activation. |
| `codewiki.codeLens` | `true` | Show "Pre-check" CodeLens. |
| `codewiki.llmProvider` | `openai` | LLM provider (openai / anthropic / deepseek / ollama). |
| `codewiki.apiKey` | — | API key for the LLM provider. |
| `codewiki.model` | `gpt-4o` | LLM model. |

## Commands

| Command | Description |
|---|---|
| Initialize | Set up CLI + MCP + index in one step |
| Health Check | Show code health panel (grade, security, patterns) |
| Open Usage Panel | Full-feature action grid |
| Open Settings | Jump to extension settings |
| Index Project | Build/rebuild ontology |
| Semantic Search | Search by meaning |
| Ask about Code | Natural-language question → entities |
| Pre-check Modification | Impact before editing |
| Analyze Impact | Full impact graph |
| Show Relations | Entity connections |
| Security Scan | Findings panel |
| Detect Patterns | Pattern/anti-pattern panel |
| Export Wiki | Markdown / HTML / JSON |
| Show Status | Index statistics |
| Refresh | Re-index + refresh views |
| Clear Security Problems | Clear scan diagnostics |

## Keybindings

| Shortcut | Command |
|---|---|
| `Ctrl/Cmd+Alt+S` | Semantic Search |
| `Ctrl/Cmd+Alt+H` | Health Check |
| `Ctrl/Cmd+Alt+P` | Pre-check (in editor) |

## Building from source

```bash
cd vscode-extension
npm install
npm run compile       # typecheck + emit
npm run package       # build .vsix
```

## License

MIT
