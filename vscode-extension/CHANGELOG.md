# Change Log

## 0.5.1

Enhanced developer experience with LSP-like features and editor integration.

### Added
- **Definition Provider**: Go-to-definition via ontology graph — `F12` / `Ctrl+Click` resolves entity definitions from cached ontology data.
- **Reference Provider**: Find All References via ontology — `Shift+F12` shows definition + incoming/outgoing relations as reference locations.
- **Document Symbol Provider**: Breadcrumb / Outline view (`Ctrl+Shift+O`) lists all CodeWiki entities in the current file with type, relation count, and range info.
- **Editor context menu**: Right-click in the editor to access Pre-check, Impact Analysis, and Show Relations directly from the context menu (grouped under `codewiki`).
- Hide `goToEntity` from command palette (internal command only).

### Changed
- Version 0.5.0 → 0.5.1.

## 0.5.0

Major feature release — interactive graph, hover info, file watching, real entity tree.

### Added
- **Knowledge Graph Webview** (`codewiki.showGraph`): interactive SVG graph with force-directed layout, type-based color coding, filter bar, zoom/pan, tooltips, and click-to-navigate to source.
- **Hover Provider**: hover over identifiers to see CodeWiki entity info — type, file, signature, relation count, and up to 5 outgoing/incoming relations.
- **File Watcher**: automatically re-indexes the project on file save/create/delete (3-second debounce).
- **Generate Wiki command** (`codewiki.generateWiki`): calls `wiki-generate` CLI to actually generate wiki pages (previously aliased to `index`).
- **Go to Entity command** (`codewiki.goToEntity`): internal command for tree view and graph click-to-navigate.
- **Code quality diagnostics**: health check now reports dead code (`DiagnosticTag.Unnecessary`), God Objects (`Warning`), and High Coupling (`Information`) to the Problems panel.
- Usage Panel buttons: added "Knowledge Graph" and "Generate Wiki".

### Changed
- **EntityTreeProvider**: fetches real entity data from CLI / `.codewiki/*.json` cache, groups by type (Class, Interface, Function, Method, Component, Type, Enum, Module, Variable), each entity is clickable and navigates to source.
- **WikiTreeProvider**: reads generated wiki pages from `.codewiki/wiki/*.md`; falls back to static page list when no wiki is generated.
- **CodeLens**: when cached data is available, shows `entity.type · N relations` instead of hardcoded "Pre-check" text.
- Reduced `any` usage throughout; replaced with `Record<string, unknown>` + type assertions, and dedicated `CliEntity` / `CliRelation` interfaces.
- Version 0.4.0 → 0.5.0.

## 0.4.0

Polish pass — diagnostics, onboarding, status-bar grade, richer tree.

### Added
- **Security findings → Problems panel**: `codewiki.scan` now publishes findings as VS Code Diagnostics (squiggles in affected files, grouped in the Problems panel), mapped high→Error / medium→Warning / low→Info. Added `codewiki.clearDiagnostics` to clear them.
- **Status-bar health grade**: after a health check / scan the status bar shows the grade (A–F) with a matching icon; click it to reopen the Health panel.
- **Getting Started walkthrough** (`codewiki.getStarted`): 3 bilingual steps (Initialize → Health Check → Usage Panel) with runnable command links.
- **Keybindings**: `Ctrl/Cmd+Alt+S` search, `Ctrl/Cmd+Alt+H` health check, `Ctrl/Cmd+Alt+P` pre-check.
- **Refresh command** (`codewiki.refresh`): re-index + refresh tree; available in the Code Entities view title and Usage Panel.
- **Code Entities tree** now shows a live entity count and themed category icons, with a click-to-initialize prompt when not indexed.

### Changed
- Version 0.3.0 → 0.4.0; status-bar command switches to Health Check once indexed.

## 0.3.0

Major feature completeness release — bilingual, health check, usage panel, init command.

### Added
- **Initialize command** (`codewiki.init`): detects CLI availability, writes `.vscode/mcp.json` for the workspace (via `codewiki init --ide vscode`), auto-indexes and verifies — one command to go from zero to ready.
- **Health Check panel** (`codewiki.healthCheck`): tabbed webview showing code health grade (A–F), security findings, and design patterns. Calls `codewiki report json` under the hood.
- **Security Scan command** (`codewiki.scan`): opens Health panel focused on the Security tab.
- **Pattern Detection command** (`codewiki.patterns`): opens Health panel focused on the Patterns tab.
- **Usage Panel** (`codewiki.openUsagePanel`): activity-bar webview with a grid of one-click action buttons (init, index, health, scan, patterns, search, ask, pre-check, impact, relations, export, settings, status). Also embeds in the sidebar under the CodeWiki activity-bar icon.
- **Settings command** (`codewiki.openSettings`): jumps to VS Code settings filtered to this extension.
- **Bilingual EN / 中文** throughout:
  - `package.nls.json` + `package.nls.zh-cn.json` for command palette titles.
  - Runtime i18n via `codewiki.language` config (`auto` / `en` / `zh`); all webview content, messages, and tree-view labels are localized.
- **Chinese README** (`README.zh-CN.md`) alongside the English `README.md`.
- Smart CLI resolution: if `cliPath` points at a runner (`npx tsx`, `ts-node`, `node`), the script path is appended; if it's a bare binary name (`codewiki`), it's used directly.

### Changed
- Version bumped to 0.3.0; `.vsix` output updated accordingly.
- Tree view labels and code-lens respect current language.
- Existing commands carried forward with minor i18n improvements.

## 0.2.0

- Packaged as an installable `.vsix` (added `package` script via `@vscode/vsce`).
- Added extension/activity-bar icon, README, LICENSE, and `.vscodeignore`.
- Typed semantic-search quick-pick items (fixes jump-to-file).
- Commands: index, search, knowledge graph, ask, impact, pre-check, relations,
  generate/export wiki, status; plus CodeLens.
