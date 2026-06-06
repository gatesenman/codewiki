import * as vscode from 'vscode'
import * as cp from 'child_process'
import * as path from 'path'

// ─── i18n ──────────────────────────────────────────────────────────────────────

type Lang = 'en' | 'zh'

function getLang(): Lang {
  const cfg = vscode.workspace.getConfiguration('codewiki').get<string>('language', 'auto')
  if (cfg === 'zh') return 'zh'
  if (cfg === 'en') return 'en'
  return vscode.env.language.startsWith('zh') ? 'zh' : 'en'
}

const I18N: Record<string, Record<Lang, string>> = {
  indexing: { en: 'Indexing project...', zh: '正在索引项目...' },
  indexed: { en: 'Project indexed', zh: '项目已索引' },
  indexFail: { en: 'Indexing failed', zh: '索引失败' },
  noWorkspace: { en: 'No workspace folder open', zh: '未打开工作区文件夹' },
  initTitle: { en: 'Initializing CodeWiki...', zh: '正在初始化 CodeWiki...' },
  initDetectCli: { en: 'Detecting CLI...', zh: '检测 CLI...' },
  initWriteMcp: { en: 'Writing MCP config for VS Code...', zh: '写入 VS Code MCP 配置...' },
  initVerify: { en: 'Verifying...', zh: '验证中...' },
  initDone: { en: 'CodeWiki initialized successfully!', zh: 'CodeWiki 初始化成功！' },
  initFailCli: { en: 'Could not find the codewiki CLI. Install globally (npm i -g .) or set codewiki.cliPath.', zh: '找不到 codewiki CLI。请全局安装（npm i -g .）或设置 codewiki.cliPath。' },
  healthTitle: { en: 'Health Check', zh: '健康检查' },
  healthRunning: { en: 'Running health check...', zh: '正在运行健康检查...' },
  healthNoData: { en: 'Could not retrieve health data. Index the project first.', zh: '无法获取健康数据，请先索引项目。' },
  settingsOpen: { en: 'Opening CodeWiki settings...', zh: '打开 CodeWiki 设置...' },
  usageTitle: { en: 'Usage Panel', zh: '使用面板' },
  scanTitle: { en: 'Security Scan', zh: '安全扫描' },
  patternsTitle: { en: 'Patterns', zh: '模式检测' },
  entities: { en: 'entities', zh: '个实体' },
  relations: { en: 'relations', zh: '条关系' },
  files: { en: 'files', zh: '个文件' },
  grade: { en: 'Grade', zh: '等级' },
  score: { en: 'Score', zh: '分数' },
  cycles: { en: 'Circular dependencies', zh: '循环依赖' },
  deadCode: { en: 'Dead code', zh: '死代码' },
  coupling: { en: 'Coupling', zh: '耦合' },
  godObject: { en: 'God objects', zh: '上帝对象' },
  secHigh: { en: 'High', zh: '高' },
  secMed: { en: 'Medium', zh: '中' },
  secLow: { en: 'Low', zh: '低' },
  findings: { en: 'findings', zh: '个发现' },
  noFindings: { en: 'No security issues found', zh: '未发现安全问题' },
  patterns: { en: 'Patterns found', zh: '已检测到的模式' },
  antiPatterns: { en: 'Anti-patterns', zh: '反模式' },
  scanRunning: { en: 'Scanning for security issues...', zh: '正在扫描安全问题...' },
  scanDone: { en: 'Security scan complete', zh: '安全扫描完成' },
  scanClean: { en: 'No security issues found', zh: '未发现安全问题' },
  scanFound: { en: 'security issue(s) added to Problems panel', zh: '个安全问题已加入「问题」面板' },
  refreshed: { en: 'CodeWiki refreshed', zh: 'CodeWiki 已刷新' },
  classes: { en: 'Classes', zh: '类' },
  interfaces: { en: 'Interfaces', zh: '接口' },
  functions: { en: 'Functions', zh: '函数' },
  types: { en: 'Types', zh: '类型' },
  notIndexed: { en: 'Not indexed — run Initialize or Index', zh: '未索引 —— 请运行「初始化」或「索引」' },
  gradeTip: { en: 'CodeWiki health grade — click for details', zh: 'CodeWiki 健康等级 —— 点击查看详情' },
}

function t(key: string): string { return I18N[key]?.[getLang()] || key }

// ─── Extension state ───────────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel
let statusBarItem: vscode.StatusBarItem
let diagnostics: vscode.DiagnosticCollection
let entityTree: EntityTreeProvider
let indexed = false
let lastEntityCount = 0

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('CodeWiki')
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBarItem.text = '$(book) CodeWiki'
  statusBarItem.tooltip = 'CodeWiki: Click to index project'
  statusBarItem.command = 'codewiki.index'
  statusBarItem.show()
  diagnostics = vscode.languages.createDiagnosticCollection('codewiki')
  context.subscriptions.push(outputChannel, statusBarItem, diagnostics)

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codewiki.init', () => cmdInit()),
    vscode.commands.registerCommand('codewiki.healthCheck', () => cmdHealthCheck(context)),
    vscode.commands.registerCommand('codewiki.openUsagePanel', () => UsagePanel.createOrShow(context)),
    vscode.commands.registerCommand('codewiki.openSettings', () => cmdOpenSettings()),
    vscode.commands.registerCommand('codewiki.index', () => cmdIndex()),
    vscode.commands.registerCommand('codewiki.searchCode', () => cmdSearch()),
    vscode.commands.registerCommand('codewiki.analyzeImpact', () => cmdAnalyzeImpact()),
    vscode.commands.registerCommand('codewiki.preCheck', () => cmdPreCheck()),
    vscode.commands.registerCommand('codewiki.showRelations', () => cmdRelations()),
    vscode.commands.registerCommand('codewiki.openWiki', () => cmdOpenWiki(context)),
    vscode.commands.registerCommand('codewiki.showGraph', () => cmdShowGraph()),
    vscode.commands.registerCommand('codewiki.askQuestion', () => cmdAsk()),
    vscode.commands.registerCommand('codewiki.scan', () => cmdScan(context)),
    vscode.commands.registerCommand('codewiki.patterns', () => cmdPatterns(context)),
    vscode.commands.registerCommand('codewiki.generateWiki', () => cmdIndex()),
    vscode.commands.registerCommand('codewiki.exportWiki', () => cmdExport()),
    vscode.commands.registerCommand('codewiki.status', () => cmdStatus()),
    vscode.commands.registerCommand('codewiki.refresh', () => cmdRefresh()),
    vscode.commands.registerCommand('codewiki.clearDiagnostics', () => diagnostics.clear()),
  )

  // Register webview sidebar panel
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codewiki.usagePanel', new UsagePanelViewProvider(context))
  )

  // Tree providers
  entityTree = new EntityTreeProvider()
  vscode.window.registerTreeDataProvider('codewiki.entities', entityTree)
  vscode.window.registerTreeDataProvider('codewiki.wikiPages', new WikiTreeProvider())

  // CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,rb,php,kt,swift}' },
      new CodeWikiCodeLensProvider()
    )
  )

  // Auto-index
  const config = vscode.workspace.getConfiguration('codewiki')
  if (config.get<boolean>('autoIndex', true)) {
    const folders = vscode.workspace.workspaceFolders
    if (folders?.[0]) autoIndex(folders[0].uri.fsPath)
  }

  outputChannel.appendLine('CodeWiki extension activated (v0.4.0)')
}

export function deactivate() { /* nothing */ }

// ─── CLI Execution ─────────────────────────────────────────────────────────────

function getProjectPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

function buildCliCommand(args: string[]): string {
  const config = vscode.workspace.getConfiguration('codewiki')
  const cliPath = config.get<string>('cliPath', 'npx tsx').trim()
  const isRunner = /\b(tsx|ts-node|node|bun|deno)\b/.test(cliPath)
  if (isRunner) {
    const script = path.resolve(__dirname, '../../cli/codewiki-cli.ts')
    return `${cliPath} "${script}" ${args.join(' ')}`
  }
  return `${cliPath} ${args.join(' ')}`
}

function runCli(args: string[], projectPath?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const cmd = buildCliCommand(args)
    const cwd = projectPath || getProjectPath() || process.cwd()
    outputChannel.appendLine(`> ${cmd}`)
    cp.exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', code: err?.code || 0 })
    })
  })
}

function runCliJson(args: string[], projectPath?: string): Promise<any> {
  return runCli([...args, '--json'], projectPath).then(({ stdout }) => {
    try { return JSON.parse(stdout) }
    catch { return { error: 'parse_failed', raw: stdout.slice(0, 500) } }
  })
}

function runCliRaw(args: string[], projectPath?: string): Promise<string> {
  return runCli(args, projectPath).then(r => r.stdout)
}

// ─── Commands ──────────────────────────────────────────────────────────────────

async function autoIndex(projectPath: string) {
  statusBarItem.text = '$(sync~spin) CodeWiki: Indexing...'
  const result = await runCliJson(['index', `"${projectPath}"`])
  if (result?.success || result?.totalEntities) {
    indexed = true
    lastEntityCount = result.totalEntities ?? 0
    statusBarItem.text = `$(book) CodeWiki: ${result.totalEntities ?? '?'} ${t('entities')}`
    statusBarItem.tooltip = `${result.totalEntities} ${t('entities')}, ${result.totalRelations} ${t('relations')}`
    statusBarItem.command = 'codewiki.healthCheck'
    entityTree?.refresh()
  } else {
    statusBarItem.text = '$(book) CodeWiki'
    outputChannel.appendLine(`Index failed: ${JSON.stringify(result)}`)
  }
}

const GRADE_ICON: Record<string, string> = { A: '$(pass)', B: '$(pass)', C: '$(info)', D: '$(warning)', F: '$(error)' }

function setGradeStatusBar(grade: string) {
  if (!grade) return
  statusBarItem.text = `${GRADE_ICON[grade] || '$(book)'} CodeWiki: ${grade}`
  statusBarItem.tooltip = t('gradeTip')
  statusBarItem.command = 'codewiki.healthCheck'
}

async function cmdRefresh() {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }
  await autoIndex(pp)
  vscode.window.showInformationMessage(t('refreshed'))
}

async function cmdIndex() {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('indexing'), cancellable: false },
    async () => { await autoIndex(pp); vscode.window.showInformationMessage(t('indexed')) }
  )
}

// ─── Init ──────────────────────────────────────────────────────────────────────

async function cmdInit() {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('initTitle'), cancellable: false },
    async (progress) => {
      // 1. Detect CLI availability
      progress.report({ message: t('initDetectCli') })
      const ver = await runCli(['version'])
      if (ver.code !== 0 && !ver.stdout.trim()) {
        // Try 'codewiki' directly
        const test = await new Promise<boolean>((resolve) => {
          cp.exec('codewiki version', { timeout: 10000 }, (err, out) => resolve(!err && !!out.trim()))
        })
        if (!test) {
          vscode.window.showErrorMessage(t('initFailCli'))
          return
        }
        // Suggest setting
        const set = await vscode.window.showInformationMessage(
          getLang() === 'zh' ? '检测到全局 codewiki CLI，是否将 cliPath 设为 "codewiki"？' : 'Detected global codewiki. Set cliPath to "codewiki"?',
          'Yes / 是', 'No / 否'
        )
        if (set?.startsWith('Yes') || set?.startsWith('是')) {
          await vscode.workspace.getConfiguration('codewiki').update('cliPath', 'codewiki', vscode.ConfigurationTarget.Workspace)
        }
      }

      // 2. Write MCP config for VS Code
      progress.report({ message: t('initWriteMcp') })
      await runCli(['init', '--ide', 'vscode', '-p', `"${pp}"`])

      // 3. Index + verify
      progress.report({ message: t('initVerify') })
      await autoIndex(pp)

      vscode.window.showInformationMessage(t('initDone'))
    }
  )
}

// ─── Health Check ──────────────────────────────────────────────────────────────

async function cmdHealthCheck(context: vscode.ExtensionContext) {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('healthRunning'), cancellable: false },
    async () => {
      const raw = await runCliRaw(['report', 'json', '-p', `"${pp}"`])
      let data: any
      try { data = JSON.parse(raw) } catch { /* */ }
      if (!data || data.error) {
        vscode.window.showWarningMessage(t('healthNoData'))
        return
      }
      if (data.health?.grade) setGradeStatusBar(data.health.grade)
      HealthPanel.createOrShow(context, data)
    }
  )
}

// ─── Security Scan ─────────────────────────────────────────────────────────────

async function cmdScan(context: vscode.ExtensionContext) {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('scanRunning'), cancellable: false },
    async () => {
      const raw = await runCliRaw(['report', 'json', '-p', `"${pp}"`])
      let data: any
      try { data = JSON.parse(raw) } catch { /* */ }
      if (!data) { vscode.window.showWarningMessage(t('healthNoData')); return }
      if (data.health?.grade) setGradeStatusBar(data.health.grade)
      const count = publishSecurityDiagnostics(pp, data)
      HealthPanel.createOrShow(context, data, 'security')
      if (count > 0) vscode.window.showWarningMessage(`CodeWiki: ${count} ${t('scanFound')}`)
      else vscode.window.showInformationMessage(`CodeWiki: ${t('scanClean')}`)
    }
  )
}

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
}

// Map CLI security findings onto the VS Code Problems panel (squiggles per file).
function publishSecurityDiagnostics(projectRoot: string, data: any): number {
  diagnostics.clear()
  const findings: any[] = data?.security?.findings || []
  if (!findings.length) return 0
  const byFile = new Map<string, vscode.Diagnostic[]>()
  for (const f of findings) {
    if (!f.file) continue
    const abs = path.isAbsolute(f.file) ? f.file : path.resolve(projectRoot, f.file)
    const line = Math.max(0, (f.line || 1) - 1)
    const range = new vscode.Range(line, 0, line, 200)
    const diag = new vscode.Diagnostic(
      range,
      `[${(f.severity || 'info').toUpperCase()}] ${f.message || f.rule || 'security finding'}`,
      SEVERITY_MAP[f.severity] ?? vscode.DiagnosticSeverity.Information
    )
    diag.source = 'CodeWiki'
    if (f.rule) diag.code = f.rule
    const list = byFile.get(abs) || []
    list.push(diag)
    byFile.set(abs, list)
  }
  for (const [file, diags] of byFile) {
    diagnostics.set(vscode.Uri.file(file), diags)
  }
  return findings.length
}

// ─── Patterns ──────────────────────────────────────────────────────────────────

async function cmdPatterns(context: vscode.ExtensionContext) {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }
  const raw = await runCliRaw(['report', 'json', '-p', `"${pp}"`])
  let data: any
  try { data = JSON.parse(raw) } catch { /* */ }
  if (!data) { vscode.window.showWarningMessage(t('healthNoData')); return }
  HealthPanel.createOrShow(context, data, 'patterns')
}

// ─── Settings ──────────────────────────────────────────────────────────────────

function cmdOpenSettings() {
  vscode.commands.executeCommand('workbench.action.openSettings', '@ext:codewiki.codewiki-vscode')
}

// ─── Other commands (carried forward) ──────────────────────────────────────────

async function cmdSearch() {
  const query = await vscode.window.showInputBox({ prompt: getLang() === 'zh' ? '语义搜索查询' : 'Semantic search query', placeHolder: 'e.g., user authentication' })
  if (!query) return
  const result = await runCliJson(['search', `"${query}"`, '-p', `"${getProjectPath()}"`])
  if (result?.results?.length) {
    interface SQP extends vscode.QuickPickItem { filePath?: string; line?: number }
    const items: SQP[] = result.results.map((r: any) => ({
      label: r.file || r.entity || r.title,
      description: `Score: ${(r.score * 100).toFixed(0)}%`,
      detail: r.snippet?.substring(0, 200),
      filePath: r.file, line: r.line,
    }))
    const sel = await vscode.window.showQuickPick(items, { placeHolder: `${items.length} results` })
    if (sel?.filePath) {
      const doc = await vscode.workspace.openTextDocument(path.resolve(getProjectPath() || '', sel.filePath))
      const ed = await vscode.window.showTextDocument(doc)
      if (sel.line) { const p = new vscode.Position(sel.line - 1, 0); ed.selection = new vscode.Selection(p, p); ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenter) }
    }
  } else {
    vscode.window.showInformationMessage(getLang() === 'zh' ? `未找到「${query}」的结果` : `No results for "${query}"`)
  }
}

async function cmdPreCheck() {
  const editor = vscode.window.activeTextEditor
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return }
  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active)
  const entityName = wordRange ? editor.document.getText(wordRange) : await vscode.window.showInputBox({ prompt: 'Entity name' })
  if (!entityName) return
  const desc = await vscode.window.showInputBox({ prompt: getLang() === 'zh' ? '计划的修改（可选）' : 'Planned modification (optional)' })
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Pre-checking ${entityName}...` }, async () => {
    const result = await runCliJson(['pre-check', `"${entityName}"`, desc ? `"${desc}"` : '', '-p', `"${getProjectPath()}"`].filter(Boolean))
    if (result?.error) { vscode.window.showErrorMessage(`CodeWiki: ${result.error}`); return }
    outputChannel.clear()
    outputChannel.appendLine(`=== Pre-Check: ${entityName} ===`)
    outputChannel.appendLine(`Type: ${result.entity?.type || '?'} | File: ${result.entity?.file || '?'}:${result.entity?.line || '?'}`)
    outputChannel.appendLine(`Risk: ${result.risk || '?'} | Impact: ${result.impactedEntities || 0} ${t('entities')}, ${result.impactedFiles || 0} ${t('files')}`)
    if (result.warnings?.length) outputChannel.appendLine(`Warnings: ${result.warnings.join(', ')}`)
    outputChannel.show()
    if (result.risk === 'HIGH') { vscode.window.showWarningMessage(`HIGH RISK — ${entityName} impacts ${result.impactedEntities} entities`) }
  })
}

async function cmdAnalyzeImpact() {
  const editor = vscode.window.activeTextEditor
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return }
  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active)
  const entityName = wordRange ? editor.document.getText(wordRange) : await vscode.window.showInputBox({ prompt: 'Entity name' })
  if (!entityName) return
  const result = await runCliJson(['impact', `"${entityName}"`, '-p', `"${getProjectPath()}"`])
  if (result?.totalEntities !== undefined) {
    outputChannel.clear()
    outputChannel.appendLine(`=== Impact: ${entityName} ===`)
    outputChannel.appendLine(`Total: ${result.totalEntities} ${t('entities')}, ${result.totalFiles} ${t('files')}`)
    if (result.byFile) { for (const [f, ents] of Object.entries(result.byFile as Record<string, any[]>)) { outputChannel.appendLine(`  ${f}:`); for (const e of ents) outputChannel.appendLine(`    - ${e.type}: ${e.name}`) } }
    outputChannel.show()
  }
}

async function cmdRelations() {
  const editor = vscode.window.activeTextEditor
  if (!editor) { vscode.window.showWarningMessage('No active editor'); return }
  const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active)
  const entityName = wordRange ? editor.document.getText(wordRange) : await vscode.window.showInputBox({ prompt: 'Entity name' })
  if (!entityName) return
  const result = await runCliJson(['relations', `"${entityName}"`, '-p', `"${getProjectPath()}"`])
  if (result?.command === 'relations') {
    outputChannel.clear()
    outputChannel.appendLine(`=== Relations: ${result.entity?.name} (${result.entity?.type}) ===`)
    if (result.outgoing?.length) { outputChannel.appendLine('Outgoing:'); for (const r of result.outgoing) outputChannel.appendLine(`  → ${r.type} → ${r.target}`) }
    if (result.incoming?.length) { outputChannel.appendLine('Incoming:'); for (const r of result.incoming) outputChannel.appendLine(`  ← ${r.type} ← ${r.source}`) }
    outputChannel.show()
  }
}

async function cmdOpenWiki(context: vscode.ExtensionContext) { WikiPanel.createOrShow(context) }
function cmdShowGraph() { vscode.window.showInformationMessage(getLang() === 'zh' ? '知识图谱可在桌面端查看，或运行 `codewiki export html`。' : 'Knowledge Graph is in the desktop app or via `codewiki export html`.') }

async function cmdAsk() {
  const q = await vscode.window.showInputBox({ prompt: getLang() === 'zh' ? '向代码提问' : 'Ask about your code' })
  if (!q) return
  const result = await runCliJson(['analyze', `"${q}"`, '-p', `"${getProjectPath()}"`])
  if (result) {
    outputChannel.clear()
    outputChannel.appendLine(`=== ${q} ===\n`)
    if (result.entities?.length) { for (const e of result.entities.slice(0, 10)) outputChannel.appendLine(`  ${e.type}: ${e.name} (${e.file}:${e.line})`) }
    if (result.searchResults?.length) { outputChannel.appendLine(''); for (const r of result.searchResults.slice(0, 5)) outputChannel.appendLine(`  ${r.file} (${(r.score * 100).toFixed(0)}%)`) }
    outputChannel.show()
  }
}

async function cmdExport() {
  const fmt = await vscode.window.showQuickPick(['markdown', 'html', 'json'], { placeHolder: 'Export format' })
  if (!fmt) return
  const result = await runCliJson(['export', fmt, '-p', `"${getProjectPath()}"`])
  if (result?.success && result.outputPath) {
    const doc = await vscode.workspace.openTextDocument(result.outputPath)
    await vscode.window.showTextDocument(doc)
  }
}

async function cmdStatus() {
  const result = await runCliJson(['status', '-p', `"${getProjectPath()}"`])
  if (result) {
    outputChannel.clear()
    outputChannel.appendLine('=== CodeWiki Status ===')
    outputChannel.appendLine(`Indexed: ${result.indexed} | ${result.totalEntities} ${t('entities')} | ${result.totalRelations} ${t('relations')} | ${result.totalFiles} ${t('files')}`)
    outputChannel.show()
  }
}

// ─── Health Panel (Webview) ────────────────────────────────────────────────────

class HealthPanel {
  static panel: vscode.WebviewPanel | undefined
  static createOrShow(context: vscode.ExtensionContext, data: any, tab?: string) {
    if (HealthPanel.panel) { HealthPanel.panel.reveal(); HealthPanel.panel.webview.html = HealthPanel.html(data, tab); return }
    const panel = vscode.window.createWebviewPanel('codewikiHealth', `CodeWiki ${t('healthTitle')}`, vscode.ViewColumn.One, { enableScripts: false })
    panel.webview.html = HealthPanel.html(data, tab)
    panel.onDidDispose(() => { HealthPanel.panel = undefined })
    HealthPanel.panel = panel
  }

  static html(data: any, focusTab?: string): string {
    const lang = getLang()
    const h = data.health || {}
    const s = data.security || {}
    const p = data.patterns || {}
    const gradeColor: Record<string, string> = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' }
    const gc = gradeColor[h.grade] || '#888'

    const healthHtml = `
      <div class="card">
        <h2>${lang === 'zh' ? '代码健康' : 'Code Health'}</h2>
        <div class="grade" style="color:${gc}">${h.grade || '?'}</div>
        <p>${t('score')}: ${h.score != null ? (h.score * 100).toFixed(0) + '/100' : '—'}</p>
        <table>
          ${(h.components || []).map((c: any) => `<tr><td>${c.key}</td><td>${(c.score * 100).toFixed(0)}%</td><td class="dim">${c.detail || ''}</td></tr>`).join('')}
        </table>
        ${h.topCycles?.length ? `<p><b>${t('cycles')}:</b> ${h.topCycles.length}</p>` : ''}
      </div>`

    const secHtml = `
      <div class="card">
        <h2>${lang === 'zh' ? '安全' : 'Security'}</h2>
        ${s.total ? `
          <p><span class="badge high">${t('secHigh')}: ${s.bySeverity?.high || 0}</span>
             <span class="badge med">${t('secMed')}: ${s.bySeverity?.medium || 0}</span>
             <span class="badge low">${t('secLow')}: ${s.bySeverity?.low || 0}</span></p>
          <p>${s.total} ${t('findings')} / ${s.filesScanned} ${t('files')}</p>
          <table>${(s.findings || []).slice(0, 20).map((f: any) => `<tr><td class="badge ${f.severity}">${f.severity}</td><td>${f.file}:${f.line}</td><td>${f.message}</td></tr>`).join('')}</table>
        ` : `<p>${t('noFindings')}</p>`}
      </div>`

    const patHtml = `
      <div class="card">
        <h2>${lang === 'zh' ? '设计模式' : 'Design Patterns'}</h2>
        ${p.total ? `
          <p>${t('patterns')}: ${Object.entries(p.counts || {}).filter(([k]) => !['GodObject', 'HighCoupling'].includes(k)).map(([k, v]) => `<span class="badge pat">${k}: ${v}</span>`).join(' ')}</p>
          <p>${t('antiPatterns')}: ${Object.entries(p.counts || {}).filter(([k]) => ['GodObject', 'HighCoupling'].includes(k)).map(([k, v]) => `<span class="badge high">${k}: ${v}</span>`).join(' ') || '—'}</p>
          <table>${(p.entities || []).slice(0, 20).map((e: any) => `<tr><td>${e.name}</td><td>${e.type}</td><td>${[...e.patterns, ...e.antiPatterns.map((a: string) => '⚠ ' + a)].join(', ')}</td></tr>`).join('')}</table>
        ` : `<p>—</p>`}
      </div>`

    const tabs = [
      { id: 'health', label: lang === 'zh' ? '健康' : 'Health', content: healthHtml },
      { id: 'security', label: lang === 'zh' ? '安全' : 'Security', content: secHtml },
      { id: 'patterns', label: lang === 'zh' ? '模式' : 'Patterns', content: patHtml },
    ]
    const active = focusTab || 'health'

    return `<!DOCTYPE html><html><head><style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
      .tabs { display:flex; gap:4px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom:16px; }
      .tab { padding: 6px 14px; cursor:pointer; border-radius: 4px 4px 0 0; background: var(--vscode-editor-background); border: 1px solid transparent; }
      .tab.active { border-color: var(--vscode-panel-border); border-bottom-color: var(--vscode-editor-background); font-weight:bold; }
      .card { margin-bottom: 20px; }
      .grade { font-size: 48px; font-weight: bold; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
      .dim { opacity: 0.7; }
      .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; margin-right:4px; }
      .badge.high { background:#ef4444; color:#fff; }
      .badge.med, .badge.medium { background:#f97316; color:#fff; }
      .badge.low { background:#eab308; color:#000; }
      .badge.pat { background:#3b82f6; color:#fff; }
      .section { display:none; } .section.active { display:block; }
    </style></head><body>
      <h1>CodeWiki ${t('healthTitle')}</h1>
      <div class="tabs">${tabs.map(tb => `<div class="tab ${tb.id === active ? 'active' : ''}" onclick="showTab('${tb.id}')">${tb.label}</div>`).join('')}</div>
      ${tabs.map(tb => `<div class="section ${tb.id === active ? 'active' : ''}" id="tab-${tb.id}">${tb.content}</div>`).join('')}
      <script>function showTab(id){document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.getElementById('tab-'+id).classList.add('active');document.querySelector('[onclick*="'+id+'"]').classList.add('active');}</script>
    </body></html>`
  }
}

// ─── Usage Panel (Webview in sidebar + standalone) ─────────────────────────────

class UsagePanelViewProvider implements vscode.WebviewViewProvider {
  constructor(private ctx: vscode.ExtensionContext) {}
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = usagePanelHtml()
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.command) vscode.commands.executeCommand(msg.command)
    })
  }
}

class UsagePanel {
  static panel: vscode.WebviewPanel | undefined
  static createOrShow(context: vscode.ExtensionContext) {
    if (UsagePanel.panel) { UsagePanel.panel.reveal(); return }
    const panel = vscode.window.createWebviewPanel('codewikiUsage', `CodeWiki ${t('usageTitle')}`, vscode.ViewColumn.One, { enableScripts: true })
    panel.webview.html = usagePanelHtml()
    panel.webview.onDidReceiveMessage((msg) => { if (msg.command) vscode.commands.executeCommand(msg.command) })
    panel.onDidDispose(() => { UsagePanel.panel = undefined })
    UsagePanel.panel = panel
  }
}

function usagePanelHtml(): string {
  const lang = getLang()
  const btns: Array<{ cmd: string; label: string; icon: string }> = [
    { cmd: 'codewiki.init', label: lang === 'zh' ? '初始化' : 'Initialize', icon: '🚀' },
    { cmd: 'codewiki.index', label: lang === 'zh' ? '索引项目' : 'Index Project', icon: '📂' },
    { cmd: 'codewiki.refresh', label: lang === 'zh' ? '刷新' : 'Refresh', icon: '🔄' },
    { cmd: 'codewiki.healthCheck', label: lang === 'zh' ? '健康检查' : 'Health Check', icon: '🏥' },
    { cmd: 'codewiki.scan', label: lang === 'zh' ? '安全扫描' : 'Security Scan', icon: '🔒' },
    { cmd: 'codewiki.patterns', label: lang === 'zh' ? '模式检测' : 'Patterns', icon: '🧩' },
    { cmd: 'codewiki.searchCode', label: lang === 'zh' ? '语义搜索' : 'Semantic Search', icon: '🔍' },
    { cmd: 'codewiki.askQuestion', label: lang === 'zh' ? '提问' : 'Ask', icon: '💬' },
    { cmd: 'codewiki.preCheck', label: lang === 'zh' ? '修改前预检' : 'Pre-check', icon: '🛡️' },
    { cmd: 'codewiki.analyzeImpact', label: lang === 'zh' ? '影响分析' : 'Impact', icon: '💥' },
    { cmd: 'codewiki.showRelations', label: lang === 'zh' ? '关系' : 'Relations', icon: '🔗' },
    { cmd: 'codewiki.exportWiki', label: lang === 'zh' ? '导出 Wiki' : 'Export Wiki', icon: '📄' },
    { cmd: 'codewiki.openSettings', label: lang === 'zh' ? '设置' : 'Settings', icon: '⚙️' },
    { cmd: 'codewiki.status', label: lang === 'zh' ? '状态' : 'Status', icon: 'ℹ️' },
  ]
  return `<!DOCTYPE html><html><head><style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; margin:0; }
    h2 { font-size:13px; margin:0 0 10px; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:6px; }
    .btn { display:flex; align-items:center; gap:6px; padding:8px 10px; border-radius:6px; cursor:pointer; border:1px solid var(--vscode-panel-border); background:var(--vscode-editor-background); font-size:12px; transition:background .1s; }
    .btn:hover { background:var(--vscode-list-hoverBackground); }
    .icon { font-size:16px; }
    .footer { margin-top:14px; font-size:11px; opacity:.7; }
  </style></head><body>
    <h2>CodeWiki ${lang === 'zh' ? '使用面板' : 'Usage Panel'}</h2>
    <div class="grid">
      ${btns.map(b => `<div class="btn" onclick="run('${b.cmd}')"><span class="icon">${b.icon}</span>${b.label}</div>`).join('\n      ')}
    </div>
    <div class="footer">${lang === 'zh' ? '提示：先运行「初始化」确保 CLI 和 MCP 配置正确。' : 'Tip: Run "Initialize" first to ensure CLI & MCP config are correct.'}</div>
    <script>const vscode=acquireVsCodeApi();function run(c){vscode.postMessage({command:c});}</script>
  </body></html>`
}

// ─── Wiki Panel ────────────────────────────────────────────────────────────────

class WikiPanel {
  static panel: vscode.WebviewPanel | undefined
  static createOrShow(context: vscode.ExtensionContext) {
    if (WikiPanel.panel) { WikiPanel.panel.reveal(); return }
    const panel = vscode.window.createWebviewPanel('codewiki', 'CodeWiki Wiki', vscode.ViewColumn.One, { enableScripts: false })
    panel.webview.html = WikiPanel.html()
    panel.onDidDispose(() => { WikiPanel.panel = undefined })
    WikiPanel.panel = panel
  }
  static html(): string {
    const lang = getLang()
    const title = lang === 'zh' ? 'CodeWiki 帮助' : 'CodeWiki Help'
    const items = lang === 'zh' ? [
      '初始化 → 确保 CLI、MCP 配置就绪',
      '索引项目 → 构建本体图谱',
      '健康检查 → 查看代码等级 (A–F)、循环依赖、安全、模式',
      '语义搜索 → 按语义搜索代码',
      '修改前预检 → 分析修改影响',
      '使用面板 → 一键访问所有功能',
    ] : [
      'Initialize → Ensure CLI & MCP config are ready',
      'Index Project → Build ontology graph',
      'Health Check → Grade (A–F), cycles, security, patterns',
      'Semantic Search → Find code by meaning',
      'Pre-check → Analyze impact before modifying',
      'Usage Panel → One-click access to all features',
    ]
    return `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:20px;}h1{border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px;}li{margin:6px 0;}</style></head><body>
      <h1>${title}</h1><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>
      <p style="margin-top:20px;opacity:.7;">${lang === 'zh' ? '按 Ctrl+Shift+P 搜索 "CodeWiki" 查看所有命令。' : 'Press Ctrl+Shift+P and type "CodeWiki" to see all commands.'}</p>
    </body></html>`
  }
}

// ─── CodeLens ──────────────────────────────────────────────────────────────────

class CodeWikiCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('codewiki')
    if (!config.get<boolean>('codeLens', true) || !indexed) return []
    const lenses: vscode.CodeLens[] = []
    const text = document.getText()
    const patterns = [/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g, /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, /(?:export\s+)?interface\s+(\w+)/g]
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const pos = document.positionAt(match.index)
        lenses.push(new vscode.CodeLens(new vscode.Range(pos, pos), { title: `$(search) Pre-check "${match[1]}"`, command: 'codewiki.preCheck' }))
      }
    }
    return lenses.slice(0, 20)
  }
}

// ─── Tree Providers ────────────────────────────────────────────────────────────

class WikiTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(e: vscode.TreeItem) { return e }
  getChildren(): vscode.TreeItem[] {
    const lang = getLang()
    return [
      Object.assign(new vscode.TreeItem(lang === 'zh' ? '项目概览' : 'Project Overview'), { command: { command: 'codewiki.openWiki', title: '' } }),
      Object.assign(new vscode.TreeItem(lang === 'zh' ? '架构' : 'Architecture'), { command: { command: 'codewiki.openWiki', title: '' } }),
      Object.assign(new vscode.TreeItem(lang === 'zh' ? '核心模块' : 'Core Modules'), { command: { command: 'codewiki.openWiki', title: '' } }),
      Object.assign(new vscode.TreeItem(lang === 'zh' ? 'API 参考' : 'API Reference'), { command: { command: 'codewiki.openWiki', title: '' } }),
    ]
  }
}

class EntityTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChange.event
  refresh() { this._onDidChange.fire() }
  getTreeItem(e: vscode.TreeItem) { return e }
  getChildren(): vscode.TreeItem[] {
    if (!indexed) {
      const ti = new vscode.TreeItem(t('notIndexed'))
      ti.command = { command: 'codewiki.init', title: '' }
      ti.iconPath = new vscode.ThemeIcon('rocket')
      return [ti]
    }
    const mk = (labelKey: string, icon: string) => {
      const ti = new vscode.TreeItem(t(labelKey))
      ti.iconPath = new vscode.ThemeIcon(icon)
      return ti
    }
    const summary = new vscode.TreeItem(`${lastEntityCount} ${t('entities')}`)
    summary.iconPath = new vscode.ThemeIcon('graph')
    summary.command = { command: 'codewiki.status', title: '' }
    return [
      summary,
      mk('classes', 'symbol-class'),
      mk('interfaces', 'symbol-interface'),
      mk('functions', 'symbol-method'),
      mk('types', 'symbol-structure'),
    ]
  }
}
