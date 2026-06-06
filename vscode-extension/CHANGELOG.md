# Change Log

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
