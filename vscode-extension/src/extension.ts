import * as vscode from 'vscode'
import * as cp from 'child_process'
import * as path from 'path'

/**
 * CodeWiki VSCode Extension
 *
 * Integrates CodeWiki's ontology-based analysis directly into VSCode.
 * Uses the CLI tool for all operations — no separate server needed.
 *
 * Features:
 * - Pre-modification analysis (before code changes)
 * - Impact analysis (what would be affected)
 * - Semantic search across codebase
 * - Entity details + relations viewer
 * - Auto-index on workspace open
 * - Inline diagnostics for high-impact changes
 */

let outputChannel: vscode.OutputChannel
let statusBarItem: vscode.StatusBarItem
let indexed = false

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('CodeWiki')
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBarItem.text = '$(book) CodeWiki'
  statusBarItem.tooltip = 'CodeWiki: Click to index project'
  statusBarItem.command = 'codewiki.index'
  statusBarItem.show()

  context.subscriptions.push(outputChannel, statusBarItem)

  // Register all commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codewiki.index', () => cmdIndex()),
    vscode.commands.registerCommand('codewiki.searchCode', () => cmdSearch()),
    vscode.commands.registerCommand('codewiki.analyzeImpact', () => cmdAnalyzeImpact()),
    vscode.commands.registerCommand('codewiki.preCheck', () => cmdPreCheck()),
    vscode.commands.registerCommand('codewiki.showRelations', () => cmdRelations()),
    vscode.commands.registerCommand('codewiki.openWiki', () => cmdOpenWiki(context)),
    vscode.commands.registerCommand('codewiki.showGraph', () => cmdShowGraph()),
    vscode.commands.registerCommand('codewiki.askQuestion', () => cmdAsk()),
    vscode.commands.registerCommand('codewiki.generateWiki', () => cmdIndex()),
    vscode.commands.registerCommand('codewiki.exportWiki', () => cmdExport()),
    vscode.commands.registerCommand('codewiki.status', () => cmdStatus()),
  )

  // Register tree view providers
  const entityTree = new EntityTreeProvider()
  vscode.window.registerTreeDataProvider('codewiki.entities', entityTree)

  const wikiTree = new WikiTreeProvider()
  vscode.window.registerTreeDataProvider('codewiki.wikiPages', wikiTree)

  // Register code lens provider for impact analysis
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx,py,java,go,rs}' },
      new CodeWikiCodeLensProvider()
    )
  )

  // Auto-index on workspace open (if not already indexed)
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) {
    autoIndex(folders[0].uri.fsPath)
  }

  outputChannel.appendLine('CodeWiki extension activated')
}

export function deactivate() {
  outputChannel?.dispose()
  statusBarItem?.dispose()
}

// ---- CLI Execution Helper ----

function getProjectPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  return folders?.[0]?.uri.fsPath
}

function getCliPath(): string {
  const config = vscode.workspace.getConfiguration('codewiki')
  return config.get<string>('cliPath', 'npx tsx')
}

function runCli(args: string[], projectPath?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const cliBase = getCliPath()
    const cliScript = path.resolve(__dirname, '../../cli/codewiki-cli.ts')
    const cmd = `${cliBase} "${cliScript}" ${args.join(' ')}`
    const cwd = projectPath || getProjectPath() || process.cwd()

    outputChannel.appendLine(`> ${cmd}`)

    cp.exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err?.code || 0,
      })
    })
  })
}

function runCliJson(args: string[], projectPath?: string): Promise<any> {
  return runCli([...args, '--json'], projectPath).then(({ stdout, code }) => {
    try {
      return JSON.parse(stdout)
    } catch {
      return { error: 'Failed to parse CLI output', raw: stdout, exitCode: code }
    }
  })
}

// ---- Commands ----

async function autoIndex(projectPath: string) {
  statusBarItem.text = '$(sync~spin) CodeWiki: Indexing...'
  const result = await runCliJson(['index', `"${projectPath}"`])
  if (result?.success) {
    indexed = true
    statusBarItem.text = `$(book) CodeWiki: ${result.totalEntities || '?'} entities`
    statusBarItem.tooltip = `Indexed: ${result.totalEntities} entities, ${result.totalRelations} relations`
  } else {
    statusBarItem.text = '$(book) CodeWiki'
    outputChannel.appendLine(`Index failed: ${JSON.stringify(result)}`)
  }
}

async function cmdIndex() {
  const projectPath = getProjectPath()
  if (!projectPath) {
    vscode.window.showWarningMessage('CodeWiki: No workspace folder open')
    return
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeWiki: Indexing project...', cancellable: false },
    async (progress) => {
      progress.report({ message: 'Building ontology graph...' })
      await autoIndex(projectPath)
      vscode.window.showInformationMessage('CodeWiki: Project indexed successfully!')
    }
  )
}

async function cmdSearch() {
  const query = await vscode.window.showInputBox({
    prompt: 'Semantic search query',
    placeHolder: 'e.g., user authentication, database connection',
  })
  if (!query) return

  const result = await runCliJson(['search', `"${query}"`, '-p', `"${getProjectPath()}"`])
  if (result?.results) {
    const items = result.results.map((r: any) => ({
      label: r.file || r.entity || r.title,
      description: `Score: ${(r.score * 100).toFixed(0)}%`,
      detail: r.snippet?.substring(0, 200),
      filePath: r.file,
      line: r.line,
    }))

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `${items.length} results for "${query}"`,
      matchOnDescription: true,
      matchOnDetail: true,
    })

    if (selected?.filePath) {
      const absPath = path.resolve(getProjectPath() || '', selected.filePath)
      const doc = await vscode.workspace.openTextDocument(absPath)
      const editor = await vscode.window.showTextDocument(doc)
      if (selected.line) {
        const pos = new vscode.Position(selected.line - 1, 0)
        editor.selection = new vscode.Selection(pos, pos)
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
      }
    }
  } else {
    vscode.window.showInformationMessage(`CodeWiki: No results for "${query}"`)
  }
}

async function cmdPreCheck() {
  const editor = vscode.window.activeTextEditor
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return }

  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active)
  const entityName = wordRange ? editor.document.getText(wordRange) : await vscode.window.showInputBox({
    prompt: 'Entity name to pre-check',
  })
  if (!entityName) return

  const desc = await vscode.window.showInputBox({
    prompt: 'What modification are you planning? (optional)',
    placeHolder: 'e.g., add caching layer, refactor authentication',
  })

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `CodeWiki: Pre-checking ${entityName}...` },
    async () => {
      const result = await runCliJson([
        'pre-check', `"${entityName}"`, desc ? `"${desc}"` : '',
        '-p', `"${getProjectPath()}"`,
      ].filter(Boolean))

      if (result?.error) {
        vscode.window.showErrorMessage(`CodeWiki: ${result.error}`)
        return
      }

      // Show results in output panel
      outputChannel.clear()
      outputChannel.appendLine(`=== Pre-Check: ${entityName} ===`)
      outputChannel.appendLine(`Type: ${result.entity?.type || 'unknown'}`)
      outputChannel.appendLine(`File: ${result.entity?.file || 'unknown'}:${result.entity?.line || '?'}`)
      outputChannel.appendLine(`Risk: ${result.risk || 'unknown'}`)
      outputChannel.appendLine(`Impact: ${result.impactedEntities || 0} entities, ${result.impactedFiles || 0} files`)
      if (result.warnings?.length) outputChannel.appendLine(`Warnings: ${result.warnings.join(', ')}`)
      if (result.relations) outputChannel.appendLine(`Relations: ${result.relations.length || 0}`)
      outputChannel.show()

      // Show warning for high-risk
      if (result.risk === 'HIGH') {
        vscode.window.showWarningMessage(
          `CodeWiki: HIGH RISK — ${entityName} impacts ${result.impactedEntities} entities across ${result.impactedFiles} files`,
          'View Details'
        ).then(choice => { if (choice === 'View Details') outputChannel.show() })
      } else {
        vscode.window.showInformationMessage(
          `CodeWiki: ${entityName} — ${result.risk} risk (${result.impactedEntities} entities affected)`
        )
      }
    }
  )
}

async function cmdAnalyzeImpact() {
  const editor = vscode.window.activeTextEditor
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return }

  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active)
  const entityName = wordRange ? editor.document.getText(wordRange) : await vscode.window.showInputBox({
    prompt: 'Entity name for impact analysis',
  })
  if (!entityName) return

  const result = await runCliJson(['impact', `"${entityName}"`, '-p', `"${getProjectPath()}"`])
  if (result?.totalEntities !== undefined) {
    outputChannel.clear()
    outputChannel.appendLine(`=== Impact Analysis: ${entityName} ===`)
    outputChannel.appendLine(`Total affected: ${result.totalEntities} entities across ${result.totalFiles} files`)
    if (result.byFile) {
      for (const [file, ents] of Object.entries(result.byFile as Record<string, any[]>)) {
        outputChannel.appendLine(`\n  ${file}:`)
        for (const e of ents) outputChannel.appendLine(`    - ${e.type}: ${e.name} (line ${e.line})`)
      }
    }
    outputChannel.show()
  }
}

async function cmdRelations() {
  const editor = vscode.window.activeTextEditor
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return }

  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active)
  const entityName = wordRange ? editor.document.getText(wordRange) : await vscode.window.showInputBox({
    prompt: 'Entity name',
  })
  if (!entityName) return

  const result = await runCliJson(['relations', `"${entityName}"`, '-p', `"${getProjectPath()}"`])
  if (result?.command === 'relations') {
    outputChannel.clear()
    outputChannel.appendLine(`=== Relations: ${result.entity?.name} (${result.entity?.type}) ===`)
    outputChannel.appendLine(`Total: ${result.totalRelations} relations\n`)
    if (result.outgoing?.length) {
      outputChannel.appendLine('Outgoing:')
      for (const r of result.outgoing) outputChannel.appendLine(`  → ${r.type} → ${r.target} (${r.targetType})`)
    }
    if (result.incoming?.length) {
      outputChannel.appendLine('\nIncoming:')
      for (const r of result.incoming) outputChannel.appendLine(`  ← ${r.type} ← ${r.source} (${r.sourceType})`)
    }
    outputChannel.show()
  }
}

async function cmdOpenWiki(context: vscode.ExtensionContext) {
  WikiPanel.createOrShow(context.extensionUri)
}

async function cmdShowGraph() {
  vscode.window.showInformationMessage(
    'CodeWiki: Knowledge Graph is available in the desktop app or via `codewiki export html`.'
  )
}

async function cmdAsk() {
  const question = await vscode.window.showInputBox({
    prompt: 'Ask about your code',
    placeHolder: 'e.g., How is the database connection handled?',
  })
  if (!question) return

  const result = await runCliJson(['analyze', `"${question}"`, '-p', `"${getProjectPath()}"`])
  if (result) {
    outputChannel.clear()
    outputChannel.appendLine(`=== CodeWiki: ${question} ===\n`)
    if (result.entities?.length) {
      outputChannel.appendLine(`Relevant entities (${result.entities.length}):`)
      for (const e of result.entities.slice(0, 10)) outputChannel.appendLine(`  ${e.type}: ${e.name} (${e.file}:${e.line})`)
    }
    if (result.searchResults?.length) {
      outputChannel.appendLine(`\nRelated code (${result.searchResults.length}):`)
      for (const r of result.searchResults.slice(0, 5)) outputChannel.appendLine(`  ${r.file} (score: ${(r.score * 100).toFixed(0)}%)`)
    }
    outputChannel.show()
  }
}

async function cmdExport() {
  const format = await vscode.window.showQuickPick(['markdown', 'html', 'json'], {
    placeHolder: 'Export format',
  })
  if (!format) return

  const result = await runCliJson(['export', format, '-p', `"${getProjectPath()}"`])
  if (result?.success) {
    const doc = await vscode.workspace.openTextDocument(result.outputPath)
    await vscode.window.showTextDocument(doc)
    vscode.window.showInformationMessage(`CodeWiki: Exported to ${result.outputPath}`)
  }
}

async function cmdStatus() {
  const result = await runCliJson(['status', '-p', `"${getProjectPath()}"`])
  if (result) {
    outputChannel.clear()
    outputChannel.appendLine('=== CodeWiki Status ===')
    outputChannel.appendLine(`Indexed: ${result.indexed}`)
    outputChannel.appendLine(`Entities: ${result.totalEntities}`)
    outputChannel.appendLine(`Relations: ${result.totalRelations}`)
    outputChannel.appendLine(`Files: ${result.totalFiles}`)
    outputChannel.show()
  }
}

// ---- Code Lens Provider ----

class CodeWikiCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!indexed) return []

    const lenses: vscode.CodeLens[] = []
    const text = document.getText()

    // Find class/function declarations and add "Analyze Impact" lens
    const patterns = [
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g,
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
      /(?:export\s+)?interface\s+(\w+)/g,
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const pos = document.positionAt(match.index)
        const range = new vscode.Range(pos, pos)
        lenses.push(new vscode.CodeLens(range, {
          title: `$(search) CodeWiki: Pre-check "${match[1]}"`,
          command: 'codewiki.preCheck',
        }))
      }
    }

    return lenses.slice(0, 20) // Limit to avoid clutter
  }
}

// ---- Tree View Providers ----

class WikiTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element }
  getChildren(): vscode.TreeItem[] {
    return [
      Object.assign(new vscode.TreeItem('Project Overview'), { command: { command: 'codewiki.openWiki', title: '' } }),
      Object.assign(new vscode.TreeItem('Architecture'), { command: { command: 'codewiki.openWiki', title: '' } }),
      Object.assign(new vscode.TreeItem('Core Modules'), { command: { command: 'codewiki.openWiki', title: '' } }),
      Object.assign(new vscode.TreeItem('API Reference'), { command: { command: 'codewiki.openWiki', title: '' } }),
    ]
  }
}

class EntityTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element }
  getChildren(): vscode.TreeItem[] {
    if (!indexed) {
      return [new vscode.TreeItem('Click "$(book) CodeWiki" to index')]
    }
    return [
      new vscode.TreeItem('Classes', vscode.TreeItemCollapsibleState.Collapsed),
      new vscode.TreeItem('Interfaces', vscode.TreeItemCollapsibleState.Collapsed),
      new vscode.TreeItem('Functions', vscode.TreeItemCollapsibleState.Collapsed),
      new vscode.TreeItem('Types', vscode.TreeItemCollapsibleState.Collapsed),
    ]
  }
}

// ---- Wiki Panel ----

class WikiPanel {
  public static currentPanel: WikiPanel | undefined
  private readonly panel: vscode.WebviewPanel

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor?.viewColumn
    if (WikiPanel.currentPanel) { WikiPanel.currentPanel.panel.reveal(column); return }
    const panel = vscode.window.createWebviewPanel('codewiki', 'CodeWiki', column || vscode.ViewColumn.One, { enableScripts: true })
    WikiPanel.currentPanel = new WikiPanel(panel)
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel
    this.panel.onDidDispose(() => { WikiPanel.currentPanel = undefined })
    this.panel.webview.html = this.getHtml()
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; }
    h1 { color: var(--vscode-textLink-foreground); border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
    .cmd { margin: 8px 0; padding: 10px 14px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    .cmd code { color: var(--vscode-textLink-foreground); }
    .section { margin-top: 24px; }
    h2 { font-size: 14px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <h1>CodeWiki</h1>
  <p>AI-powered code knowledge base with ontology-based semantic model for precise code modifications.</p>

  <div class="section">
    <h2>Available Commands</h2>
    <div class="cmd"><code>CodeWiki: Semantic Search</code> — Find code by meaning</div>
    <div class="cmd"><code>CodeWiki: Pre-check</code> — Analyze before modifying</div>
    <div class="cmd"><code>CodeWiki: Analyze Impact</code> — What would be affected</div>
    <div class="cmd"><code>CodeWiki: Show Relations</code> — Entity connections</div>
    <div class="cmd"><code>CodeWiki: Export Wiki</code> — Export as Markdown/HTML/JSON</div>
    <div class="cmd"><code>CodeWiki: Status</code> — Index statistics</div>
  </div>

  <div class="section">
    <h2>Code Agent Workflow</h2>
    <ol>
      <li>Open workspace → CodeWiki auto-indexes on activation</li>
      <li>Place cursor on a class/function name</li>
      <li>Run <code>CodeWiki: Pre-check</code> to see impact before changes</li>
      <li>Modify code with confidence knowing the full dependency graph</li>
      <li>Run <code>CodeWiki: Analyze Impact</code> to verify no unintended effects</li>
    </ol>
  </div>

  <div class="section">
    <h2>CLI Integration</h2>
    <p>The extension uses the <code>codewiki-cli</code> under the hood. You can also use it directly:</p>
    <div class="cmd"><code>npx tsx cli/codewiki-cli.ts pre-check UserService "add caching" --json</code></div>
  </div>
</body>
</html>`
  }
}
