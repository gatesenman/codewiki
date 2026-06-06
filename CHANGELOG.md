# Changelog

All notable changes to CodeWiki will be documented in this file.

## [1.1.0] — 2026-06-06

### Added
- **Code Map** — DeepWiki-style interactive code visualization with 4 sub-views:
  Treemap, Module Graph, Explorer, Architecture diagrams
- **Wiki Export** — Export wiki to Markdown, JSON, or HTML with one click
- **Repo Map for LLM** — Generate concise code context maps for AI coding assistants
- **PR Review Agent** (`pr-review.ts`) — Impact-aware code review using ontology graph
- **Natural Language → Graph Query** (`nl-graph-query.ts`) — Ask questions in
  plain English/Chinese, get precise graph results
- **Ontology Reranker** — Search results reranked using graph-based relevance
- **Architecture Diagrams** — Auto-generated Mermaid diagrams: module dependencies,
  class hierarchy, component flow, sequence diagrams
- **PlantUML Export** — Export architecture diagrams in PlantUML format
- **Graph Persistence** — JSON-based graph storage independent of Electron cache
- **Git Hooks** — Post-commit hook for automatic incremental re-indexing
- **GitHub Actions CI** — lint → typecheck → test → build pipeline
- **Unified Diff View** — LCS-based diff in Code Agent panel
- **Health Trend Tracking** — Record and visualize health metrics over time
- **Graph History UI** — Timeline chart + expandable diff details in Insights panel
- **One-click Install Scripts** — `install.sh` (macOS/Linux) + `install.ps1` (Windows)
- **React ErrorBoundary** — Component crash recovery instead of white screen
- **Prettier Configuration** — `.prettierrc` for consistent code formatting
- **CONTRIBUTING.md** — Contributor guide with setup, testing, and PR workflow
- **109 unit tests** (Vitest) covering 13 core service modules

### Changed
- **ESLint 9 migration** — Flat config (`eslint.config.mjs`) replacing deprecated `.eslintrc`
- **i18n split** — 1421-line `i18n.ts` → modular `locales/en.json` + `zh.json` (445+ keys)
- **Zustand store split** — Single 298-line file → 6 domain slices
- **SettingsModal split** — 858 lines → 137-line shell + 10 tab components
- **README version update** — Download links updated to v1.0.4 / vscode-0.5.1

### VSCode Extension (v0.5.1)
- Knowledge Graph Webview with SVG visualization
- Hover info showing entity details and relations
- File watcher for auto re-indexing on save
- Definition Provider (F12 / Ctrl+Click)
- Reference Provider (Shift+F12)
- Document Symbol Provider (Ctrl+Shift+O)
- Editor context menu integration
- Entity tree view with type grouping
- All emoji icons replaced with VSCode codicons

## [1.0.4] — Previous release

Initial stable release with Desktop + CLI + MCP Server + VSCode extension.
