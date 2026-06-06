/**
 * Git Hook Integration
 *
 * Provides utilities to install/uninstall a post-commit hook that triggers
 * automatic re-indexing of the CodeWiki ontology graph. This keeps the wiki
 * and knowledge graph up-to-date without manual intervention.
 *
 * Works in both Electron (via IPC) and CLI environments.
 */

export const HOOK_NAME = 'post-commit'
export const HOOK_MARKER = '# codewiki-auto-sync'

/**
 * Generate the hook script content.
 * Uses `codewiki` CLI if available, otherwise silently skips.
 */
export function generateHookScript(): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Auto-sync CodeWiki ontology graph after each commit.
# Installed by CodeWiki — remove this file to disable.

if command -v codewiki >/dev/null 2>&1; then
  codewiki index --incremental "$(git rev-parse --show-toplevel)" &
fi
`
}

/**
 * Generate a CI workflow snippet for GitHub Actions.
 */
export function generateCIWorkflow(): string {
  return `name: CodeWiki Sync

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  codewiki-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install CodeWiki CLI
        run: |
          npm install -g codewiki
      - name: Re-index
        run: codewiki index .
      - name: Generate Wiki
        run: codewiki wiki-generate .
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
      - name: Commit updated wiki
        run: |
          git config user.name "codewiki-bot"
          git config user.email "codewiki-bot@users.noreply.github.com"
          git add .codewiki/
          git diff --cached --quiet || git commit -m "docs: auto-sync CodeWiki"
          git push || true
`
}

export interface HookFileIO {
  readFile(path: string): Promise<string | null>
  writeFile(path: string, content: string): Promise<void>
  chmod?(path: string, mode: string): Promise<void>
  exists?(path: string): Promise<boolean>
  ensureDir?(path: string): Promise<void>
}

/**
 * Install the post-commit hook into the given git repo.
 * Returns { installed: true } or { installed: false, reason: string }.
 */
export async function installHook(
  projectPath: string,
  io: HookFileIO,
): Promise<{ installed: boolean; reason?: string }> {
  const sep = projectPath.includes('\\') ? '\\' : '/'
  const hooksDir = projectPath + sep + '.git' + sep + 'hooks'
  const hookPath = hooksDir + sep + HOOK_NAME

  // Check if .git/hooks exists
  if (io.ensureDir) {
    try {
      await io.ensureDir(hooksDir)
    } catch {
      return { installed: false, reason: 'Cannot create .git/hooks directory' }
    }
  }

  // Check if hook already exists
  try {
    const existing = await io.readFile(hookPath)
    if (existing && existing.includes(HOOK_MARKER)) {
      return { installed: true, reason: 'Already installed' }
    }
    if (existing && existing.trim().length > 0) {
      // Append to existing hook
      const merged = existing.trimEnd() + '\n\n' + generateHookScript().split('\n').slice(1).join('\n')
      await io.writeFile(hookPath, merged)
      if (io.chmod) await io.chmod(hookPath, '755')
      return { installed: true }
    }
  } catch {
    // File doesn't exist, create new
  }

  await io.writeFile(hookPath, generateHookScript())
  if (io.chmod) await io.chmod(hookPath, '755')
  return { installed: true }
}

/**
 * Remove the CodeWiki post-commit hook (or just the CodeWiki section if
 * the hook has other content).
 */
export async function uninstallHook(
  projectPath: string,
  io: HookFileIO,
): Promise<{ removed: boolean; reason?: string }> {
  const sep = projectPath.includes('\\') ? '\\' : '/'
  const hookPath = projectPath + sep + '.git' + sep + 'hooks' + sep + HOOK_NAME

  try {
    const content = await io.readFile(hookPath)
    if (!content || !content.includes(HOOK_MARKER)) {
      return { removed: false, reason: 'CodeWiki hook not found' }
    }

    // Remove CodeWiki section
    const lines = content.split('\n')
    const filtered: string[] = []
    let inCodewikiBlock = false

    for (const line of lines) {
      if (line.includes(HOOK_MARKER)) {
        inCodewikiBlock = true
        continue
      }
      if (inCodewikiBlock && line.startsWith('#') && !line.includes('codewiki')) {
        inCodewikiBlock = false
      }
      if (inCodewikiBlock && (line.includes('codewiki') || line.trim() === '' || line.startsWith('fi'))) {
        continue
      }
      inCodewikiBlock = false
      filtered.push(line)
    }

    const remaining = filtered.join('\n').trim()
    if (remaining === '#!/bin/sh' || remaining === '') {
      await io.writeFile(hookPath, '')
    } else {
      await io.writeFile(hookPath, remaining + '\n')
    }

    return { removed: true }
  } catch {
    return { removed: false, reason: 'Cannot read hook file' }
  }
}

/**
 * Check if the CodeWiki hook is already installed.
 */
export async function isHookInstalled(
  projectPath: string,
  io: HookFileIO,
): Promise<boolean> {
  const sep = projectPath.includes('\\') ? '\\' : '/'
  const hookPath = projectPath + sep + '.git' + sep + 'hooks' + sep + HOOK_NAME
  try {
    const content = await io.readFile(hookPath)
    return !!content && content.includes(HOOK_MARKER)
  } catch {
    return false
  }
}
