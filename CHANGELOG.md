# Changelog

All notable changes to CodeWiki are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.4] — 2026-06-06

VS Code extension feature-completeness release (extension `0.4.0`).

### Added
- **VS Code extension v0.4.0** — bilingual (EN/中文) feature-complete companion:
  - **Initialize** command: detect CLI, write `.vscode/mcp.json`, index + verify.
  - **Health Check** tabbed panel (grade A–F / security / patterns) + status-bar grade.
  - **Security Scan** publishes findings to the **Problems** panel (per-file squiggles).
  - **Usage Panel** (activity-bar sidebar + standalone) with one-click action buttons.
  - **Getting Started walkthrough**, keybindings, Refresh command, richer entity tree.
  - Settings command; runtime i18n via `codewiki.language`; `README.zh-CN.md`.

## [1.0.3] — 2026-06-06

CodeFlow-inspired "trust signals" release: turn the read-only ontology into
risk-aware, explainable insights that help humans and AI agents change code
safely. Plus a round of settings wiring/UX, an interactive CLI/TUI, IDE config
export and the 3D-graph crash fix.

### Added
- **Code health score (A–F)** — circular-dependency detection (Tarjan SCC),
  dead-code, coupling and god-object metrics combined into a weighted grade.
  Insights → Health tab and `codewiki health`.
- **Git churn & ownership** — per-file commit frequency, author distribution and
  recency from `git log`. `codewiki churn` / `codewiki ownership`.
- **Security findings scanner** — conservative rule-based scan (hardcoded
  secrets with masking, `eval`, SQL/shell injection, unsafe HTML, debug, weak
  random, cleartext HTTP). Insights → Security tab and `codewiki scan`.
- **Design pattern / anti-pattern detection** — Singleton/Factory/Observer/
  Builder/Strategy/Repository plus God-Object/High-Coupling anti-patterns, shown
  as badges in the entity detail panel and via `codewiki patterns`.
- **Graph color modes** — color the 2D graph by Type, Coupling (degree heatmap)
  or Risk (anti-pattern/pattern), with a mode-aware legend.
- **Aggregate analysis report** — `codewiki report [json|md] [-o file]` combining
  health, security and patterns into one document.
- **README health card workflow** — `.github/workflows/codewiki-health-card.yml`
  regenerates a health/security/pattern badge card in the README on every push
  to `main`.
- **Interactive CLI/TUI console** (`codewiki tui`), one-click CLI install
  (`install-cli.sh` / `install-cli.ps1`), and `codewiki init --ide <…>` to export
  IDE-specific MCP/agent config for code agents; `codewiki mcp-guide`.
- **Insights panel** wiring the previously unreferenced services (NL graph query,
  architecture evolution, wiki-incremental, eval harness) into the UI.

### Changed
- All remaining orphaned settings are now wired to real behavior, with
  conditional linkages, disabled states and default-filling numeric inputs.

### Fixed
- 3D knowledge graph now auto-degrades to the 2D graph (with a notice) instead of
  showing a blank canvas when WebGL/GPU is unavailable or the 3D library crashes.

## [1.0.2] — 2026-06-04

Phase 5 feature release, integrating the P0–P3 roadmap. Cross-platform
installers (Windows / macOS / Linux) and the VSCode extension are published on
the [v1.0.2 release](https://github.com/gaosichun888/codewiki/releases/tag/v1.0.2).

### Added
- **3D knowledge graph** — GitNexus-style 3D force-directed graph (three.js /
  `3d-force-graph`) with orbit/zoom/pan, type-colored nodes, optional labels and
  auto-rotation; toggle 2D/3D in Settings → Graph.
- **Enriched settings** — settings panel expanded to 10 tabs, adding Privacy &
  Security, Verification, and MCP Server sections; privacy
  (`.codewikiignore` / sensitive-file masking / secret redaction) and embedding
  options are wired into the indexer and retrieval services.
- **Chinese-by-default UI** — `lang=zh-CN`, all components fully bilingual.
- **Built-in CLI debugger** — interactive `codewiki debug` REPL with
  session-scoped project/depth and quote-aware argument parsing.
- **MCP server configuration UI** — configure transport, `PROJECT_PATH`,
  `CODEWIKI_LOG_DIR`, `CODEWIKI_CONSUMER`, and a tool allowlist from Settings.
- **Installable VSCode extension** — packaged as `codewiki-vscode-0.2.0.vsix`
  (`code --install-extension`).
- **Cross-platform CI builds** — GitHub Actions matrix builds Windows / macOS /
  Linux installers plus the `.vsix`, attached to the GitHub Release on tag push.

### Integrated roadmap (P0–P3)
- AST-based parsing for TS/JS (TypeScript compiler API; regex fallback for other
  languages).
- Hybrid retrieval — pluggable embedding providers (OpenAI-compatible + Ollama)
  with RRF fusion; off by default.
- LSIF consumer for compiler-precise `calls`/`uses` relations.
- Atomic multi-file patch apply with dry-run preview and rollback.
- Sandboxed verification (lint/build/test) with timeout protection; off by
  default.
- Multi-step agent planner with memory (analyze → apply → verify → rollback &
  retry on failure).
- Persistent index cache + file-watch incremental reindex.
- Monorepo workspace awareness (Package nodes + cross-package `dependsOn`) and
  on-demand subgraphs.
- `.codewikiignore`, sensitive-file masking, and secret redaction.
- Evaluation harness (precision/recall/F1 + baseline regression).
- PR impact-analysis bot (blast radius + suggested tests as a PR comment).
- Natural-language → graph query (bilingual, no LLM required).
- Incremental Wiki regeneration (only affected pages).
- Graph history (compare ontology snapshots across commits).

### Fixed
- `npm run build:mcp` previously pointed at a missing `server/tsconfig.json` and
  could not emit `dist/server/mcp-server.js`; added the tsconfig so the MCP
  server now builds correctly.

### Notes
- macOS `.dmg` builds are unsigned: on first launch use right-click → Open, or
  allow under System Settings → Privacy & Security.
- The app runs fully locally; embeddings and hybrid retrieval are opt-in.

[1.0.2]: https://github.com/gaosichun888/codewiki/releases/tag/v1.0.2
