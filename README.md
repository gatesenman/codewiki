<div align="center">

# CodeWiki

<img src="docs/images/welcome-zh.png" alt="CodeWiki" width="720" />

### AI Code Knowledge Base — ontology-based semantic understanding of any codebase

A cross-platform desktop app (Windows / macOS / Linux) that turns any local folder or GitHub
repository into a living wiki, an interactive knowledge graph, semantic search, a RAG chat, and a
precise, impact-aware code agent — all powered by an **ontology model** of your code.

**English** · [简体中文](README.zh-CN.md)

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2b3137)
![Electron](https://img.shields.io/badge/Electron-React%2018%20%2B%20TypeScript-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/built%20with-Vite-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-3fb950)

</div>

<!-- codewiki-health-card:start -->

_The code-health card is generated automatically on every push to `main` by the [CodeWiki Health Card](.github/workflows/codewiki-health-card.yml) workflow (`codewiki report` -> health/security/pattern badges)._

<!-- codewiki-health-card:end -->

---

## About

Large codebases are hard to understand and even harder to change safely. Most "AI for code" tools
treat source as plain text, which leads to hallucinated answers and risky edits.

**CodeWiki is different.** It first parses your project into a typed **ontology** — a graph of
*entities* (packages, files, classes, interfaces, functions, methods, components, types) connected
by *relations* (`contains`, `imports`, `extends`, `implements`, `calls`, `uses`, `dependsOn`, …).
Every other feature is grounded in that graph:

- 📖 **Wiki** pages are generated from real structure, not guesses.
- 🕸️ **Knowledge Graph** lets you *see* how the code fits together.
- 🔎 **Semantic Search** ranks code, entities, and docs by meaning.
- 💬 **Ask (RAG Chat)** answers with `file:line` citations grounded in the ontology.
- 🤖 **Code Agent** runs impact analysis on the graph before proposing edits, so changes stay
  precise and aware of cross-file dependencies.

It runs fully on your machine. The local TF‑IDF search needs no external service, and you bring your
own LLM key (OpenAI / Anthropic / DeepSeek) or run entirely offline with **Ollama**. CodeWiki also
ships a **Model Context Protocol (MCP) server** so editors like Cursor or Claude can query the same
knowledge base, plus a companion **VSCode extension**.

## Screenshots

| Knowledge Graph | Generated Wiki (real DeepSeek output) |
| --- | --- |
| ![Knowledge graph](docs/images/graph.png) | ![Generated wiki](docs/images/wiki-generated.png) |

| AI Architecture Diagram + Component Table | Semantic Search |
| --- | --- |
| ![Generated architecture](docs/images/wiki-diagram.png) | ![Search](docs/images/search.png) |

| LLM Settings | |
| --- | --- |
| ![Settings](docs/images/settings.png) | |

> The "Generated Wiki" screenshots above are produced live by CodeWiki indexing this very
> repository (354 entities / 832 relations) and generating documentation with **DeepSeek** —
> including the Mermaid architecture diagram and the component table with real `file:line` references.

## Features

### Core Wiki Engine
- **Instant Wiki Generation**: Select a local folder or GitHub repo URL → AI generates comprehensive wiki documentation
- **Mermaid Diagrams**: Auto-generated architecture and data-flow diagrams
- **Wiki Navigation**: Sidebar page tree with inline source references and a per-page quality check

### Ontology-Based Semantic Model
- **Code Ontology**: RDF-like knowledge graph of code entities (classes, functions, interfaces, modules)
- **Relation Extraction**: Automatically detects imports, extends, implements, calls, and contains relationships
- **Impact Analysis**: Query the ontology to find every entity affected by a change
- **Type-Aware Retrieval**: Semantic search enhanced with ontology relationships

### Knowledge Graph Visualization
- **D3 Force Graph**: Interactive visualization of code entity relationships
- **Entity Filtering**: Filter by type (Class, Function, Interface, Component, …)
- **Drag & Zoom**: Navigate large codebases visually
- **Color-Coded**: Distinct colors per entity type

### Semantic Search
- **TF-IDF Vector Store**: Local semantic search with no external API
- **Ontology-Aware**: Results enriched with entity relationships
- **Multi-Type**: Search across wiki, code, and entities simultaneously

### RAG-Powered Chat (Ask)
- **Context-Grounded Answers**: Retrieval-Augmented Generation with code ontology context
- **Source References**: Every answer links to specific `file:line` references
- **Streaming Responses**: Real-time streaming for OpenAI-compatible providers

### Code Agent
- **Ontology-Constrained Modifications**: Uses the knowledge graph for impact analysis before changes
- **Precise Changes**: Exact file paths, line numbers, and diffs
- **Anti-Hallucination**: Verifies all changes against the actual code structure
- **Multi-File Awareness**: Understands cross-file dependencies

### MCP (Model Context Protocol) Server
- **29 MCP Tools**: code search, ontology lookups, call-graph traversal, impact/blast-radius analysis, architecture overview, dead-code detection, reindexing, and more — see [docs/MCP.md](docs/MCP.md) for the full list
- **IDE Integration**: Any MCP-compatible IDE or agent (Claude Desktop, Cursor, VS Code, Windsurf, Cline, …) can query the code knowledge base
- **Stdio Protocol**: Standard MCP server over stdio
- **Setup guide**: [docs/MCP.md](docs/MCP.md) ([中文](docs/MCP.zh-CN.md))

### VSCode Extension
- **Sidebar Views**: Wiki pages, code entities, chat panel
- **Commands**: Open Wiki, Semantic Search, Knowledge Graph, Ask, Generate Wiki, Impact Analysis
- **MCP Client**: Communicates with the CodeWiki desktop app

## Tech Stack

- **Desktop**: Electron + React 18 + TypeScript + Vite
- **Styling**: TailwindCSS (dark theme)
- **LLM**: OpenAI / Anthropic / DeepSeek / Ollama (local)
- **Ontology**: Custom RDF-like entity-relation model
- **Vector Store**: TF-IDF local vector store
- **Diagrams**: Mermaid.js
- **Graph**: D3-force
- **State**: Zustand
- **MCP**: `@modelcontextprotocol/sdk`
- **VSCode**: VSCode Extension API

## Quick Install (one-click)

Requires Node.js 18+ and git. Clones, builds, and packages for your platform automatically. See [INSTALL.md](INSTALL.md) for details and prebuilt downloads.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.ps1 | iex
```

Prebuilt installers (`.AppImage`, `.deb`, Windows `.exe`, macOS `.dmg`) are published on [GitHub Releases](https://github.com/gaosichun888/codewiki/releases).

## Getting Started (from source)

```bash
# Install dependencies
npm install

# Development mode
npm run electron:dev

# Build for production
npm run electron:build
```

## Configuration

1. Open the app → click **Settings** (gear icon)
2. Select your LLM provider (OpenAI, Anthropic, DeepSeek, Ollama)
3. Enter your API key (not needed for Ollama)
4. Select a model

## MCP Server Configuration

Build the server, then point your MCP client at the compiled output:

```bash
npm install
npm run build:mcp   # -> dist/server/mcp-server.js
```

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

Use **absolute paths**. `PROJECT_PATH` is the project the server indexes; the
optional `CODEWIKI_LOG_DIR` (default `~/.codewiki`) sets where the call log is
written.

Full setup for Claude Desktop, Cursor, VS Code, Windsurf and others, the complete
tool reference, and troubleshooting are in **[docs/MCP.md](docs/MCP.md)**
(中文：**[docs/MCP.zh-CN.md](docs/MCP.zh-CN.md)**).

## Project Structure

```
codewiki/
├── electron/           # Electron main process
│   ├── main.ts        # Window management, IPC handlers, file system
│   └── preload.ts     # Context bridge API
├── src/               # React renderer
│   ├── components/    # UI components (Welcome, Layout, TopBar, Sidebar,
│   │                  #   WikiViewer, KnowledgeGraph, SearchPanel, ChatPanel,
│   │                  #   CodeAgentPanel, SettingsModal, MermaidDiagram)
│   ├── services/      # ontology, indexer, vector-store, llm,
│   │                  #   wiki-generator, code-agent, mcp-server
│   ├── store/         # Zustand state management
│   └── types/         # TypeScript type definitions
├── server/            # Standalone MCP server
├── vscode-extension/  # VSCode extension
└── package.json
```

## License

[MIT](LICENSE)
