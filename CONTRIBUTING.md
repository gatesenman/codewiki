# Contributing to CodeWiki

Thank you for your interest in CodeWiki! This guide helps you get started.

## Prerequisites

- **Node.js** 18+
- **npm** 9+
- **git**

## Setup

```bash
git clone https://github.com/gaosichun888/codewiki.git
cd codewiki
npm install
```

## Development

```bash
# Desktop app (Electron + Vite)
npm run electron:dev

# Web-only (no Electron shell)
npm run dev

# CLI
npm run build:cli
npx codewiki index .

# MCP Server
npm run build:mcp

# VSCode extension
cd vscode-extension && npm install && npm run compile
```

## Quality Checks

Run these before submitting a PR:

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript strict mode
npm test              # Vitest unit tests
```

## Project Structure

| Directory | Purpose |
|---|---|
| `src/components/` | React UI components |
| `src/services/` | Core business logic (ontology, indexer, LLM, wiki-generator, etc.) |
| `src/store/` | Zustand state management |
| `src/types/` | Shared TypeScript types |
| `electron/` | Electron main process + preload |
| `server/` | MCP server (standalone Node) |
| `cli/` | CLI tool |
| `vscode-extension/` | VSCode extension |

## Architecture

CodeWiki's core is the **ontology model**: code is parsed into entities (classes, functions, interfaces, etc.) and relations (imports, calls, extends, etc.), forming a knowledge graph. All features (Wiki generation, graph visualization, semantic search, RAG chat, Code Agent) build on this graph.

Key services in `src/services/`:
- `ontology.ts` — Entity/relation extraction (regex + tree-sitter + TS AST)
- `indexer.ts` — Project file scanning and indexing
- `graph-query.ts` — Natural-language → graph queries (no LLM needed)
- `health-analyzer.ts` — Code health scoring (circular deps, dead code, god objects)
- `wiki-generator.ts` — LLM-powered wiki generation from ontology
- `code-agent.ts` — Ontology-constrained code modifications

## Writing Tests

Tests live in `src/services/__tests__/` and use [Vitest](https://vitest.dev/).

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

The pure-function services (graph-query, health-analyzer, security-scan, privacy-filter, pattern-detector) are the easiest to test — no mocking needed.

## Pull Requests

1. Fork and create a feature branch
2. Make focused, minimal changes
3. Ensure `npm run lint && npm run typecheck && npm test` all pass
4. Open a PR against `main`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
