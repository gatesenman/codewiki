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
npm run lint          # ESLint 9 (flat config)
npm run typecheck     # TypeScript strict mode
npm test              # Vitest unit tests (126 tests)
```

## Project Structure

| Directory | Purpose |
|---|---|
| `src/components/` | React UI components (Layout, WikiViewer, KnowledgeGraph, KnowledgeGraph3D, CodeMap, SearchPanel, ChatPanel, CodeAgentPanel, InsightsPanel, SettingsModal, ErrorBoundary) |
| `src/services/` | Core business logic (30+ modules — see below) |
| `src/store/` | Zustand state management (6 slices: project, ui, chat, search, graph, settings) |
| `src/locales/` | i18n translations (en.json, zh.json — 450+ keys) |
| `src/types/` | Shared TypeScript types |
| `electron/` | Electron main process + preload |
| `server/` | MCP server (standalone Node, 29 tools) |
| `cli/` | CLI tool (index, search, impact, report, review) |
| `vscode-extension/` | VSCode extension (v0.5.1) |

## Architecture

CodeWiki's core is the **ontology model**: code is parsed into entities (classes, functions, interfaces, etc.) and relations (imports, calls, extends, etc.), forming a knowledge graph. All features (Wiki generation, Code Map, graph visualization, semantic search, RAG chat, Code Agent, PR Review) build on this graph.

### Key Services in `src/services/`

| Service | Description |
|---|---|
| `ontology.ts` | Entity/relation extraction (regex + tree-sitter + TS AST) |
| `indexer.ts` | Project file scanning and indexing |
| `graph-query.ts` | Structured graph queries (no LLM needed) |
| `nl-graph-query.ts` | Natural language → graph queries (EN/ZH, regex-based intent detection) |
| `health-analyzer.ts` | Code health scoring (circular deps, dead code, god objects, coupling) |
| `health-trend.ts` | Health snapshots over time, trend detection |
| `security-scan.ts` | Security vulnerability detection |
| `wiki-generator.ts` | LLM-powered wiki generation from ontology |
| `wiki-export.ts` | Export wiki to Markdown/JSON/HTML |
| `code-agent.ts` | Ontology-constrained code modifications |
| `pr-review.ts` | Impact-aware PR review using ontology graph |
| `architecture-diagram.ts` | Auto-generated Mermaid diagrams + PlantUML export |
| `codemap-analyzer.ts` | Code Map data aggregation (treemap, modules, files) |
| `ontology-reranker.ts` | Graph-based search result reranking |
| `graph-persistence.ts` | JSON-based graph storage |
| `repo-map.ts` | LLM-focused code context map generation |
| `diff-utils.ts` | LCS-based unified diff |
| `git-hooks.ts` | Post-commit hook for auto re-indexing |
| `eval-harness.ts` | Evaluation framework for query accuracy |
| `graph-history.ts` | Graph snapshot diffing and timeline |
| `pattern-detector.ts` | Design pattern detection |
| `privacy-filter.ts` | Sensitive data filtering |
| `i18n.ts` | Internationalization (EN/ZH) |

## Writing Tests

Tests live in `src/services/__tests__/` and use [Vitest](https://vitest.dev/).

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

Currently 126 tests across 16 test files covering: graph-query, health-analyzer, security-scan, privacy-filter, pattern-detector, ontology-reranker, architecture-diagram, codemap-analyzer, graph-persistence, git-hooks, diff-utils, wiki-export, repo-map, pr-review, nl-graph-query, health-trend.

The pure-function services are the easiest to test — no mocking needed. When adding a new service, create a corresponding test file in `__tests__/`.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `refactor:` — Code refactoring (no behavior change)
- `test:` — Adding or updating tests
- `chore:` — Build, CI, tooling changes

## Pull Requests

1. Fork and create a feature branch
2. Make focused, minimal changes
3. Ensure `npm run lint && npm run typecheck && npm test` all pass
4. Open a PR against `main`
5. Describe what changed and why in the PR body

## Code Style

- **ESLint 9** with TypeScript plugin (flat config in `eslint.config.mjs`)
- **Prettier** for formatting (`.prettierrc`)
- Follow existing conventions in surrounding code
- Prefer pure functions for testability
- Use existing libraries (D3, three.js, Mermaid) — don't add new dependencies without discussion

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
