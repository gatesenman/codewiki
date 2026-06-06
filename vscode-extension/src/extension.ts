import * as vscode from 'vscode'
import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

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
  methods: { en: 'Methods', zh: '方法' },
  modules: { en: 'Modules', zh: '模块' },
  components: { en: 'Components', zh: '组件' },
  enums: { en: 'Enums', zh: '枚举' },
  variables: { en: 'Variables', zh: '变量' },
  notIndexed: { en: 'Not indexed — run Initialize or Index', zh: '未索引 —— 请运行「初始化」或「索引」' },
  gradeTip: { en: 'CodeWiki health grade — click for details', zh: 'CodeWiki 健康等级 —— 点击查看详情' },
  generating: { en: 'Generating wiki...', zh: '正在生成 Wiki...' },
  generated: { en: 'Wiki generated', zh: 'Wiki 已生成' },
  generateFail: { en: 'Wiki generation failed', zh: 'Wiki 生成失败' },
  reindexing: { en: 'Re-indexing changed files...', zh: '正在重新索引变更文件...' },
  graphTitle: { en: 'Knowledge Graph', zh: '知识图谱' },
  deadCodeDiag: { en: 'Potentially dead code (unused)', zh: '可能的死代码（未被使用）' },
  godObjectDiag: { en: 'God object — too many responsibilities', zh: '上帝对象 —— 职责过多' },
  highCouplingDiag: { en: 'Highly coupled entity', zh: '高耦合实体' },
}

function t(key: string): string { return I18N[key]?.[getLang()] || key }

// ─── Extension state ───────────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel
let statusBarItem: vscode.StatusBarItem
let diagnostics: vscode.DiagnosticCollection
let entityTree: EntityTreeProvider
let wikiTree: WikiTreeProvider
let indexed = false
let lastEntityCount = 0
let lastRelationCount = 0
let cachedEntities: CliEntity[] = []
let cachedRelations: CliRelation[] = []
let reindexTimer: ReturnType<typeof setTimeout> | undefined
let fileWatcher: vscode.FileSystemWatcher | undefined

// Cached report data for hover / diagnostics
interface CliEntity { id: string; name: string; type: string; filePath: string; line: number; endLine: number; signature?: string }
interface CliRelation { id: string; source: string; target: string; type: string }

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
    vscode.commands.registerCommand('codewiki.showGraph', () => cmdShowGraph(context)),
    vscode.commands.registerCommand('codewiki.askQuestion', () => cmdAsk()),
    vscode.commands.registerCommand('codewiki.scan', () => cmdScan(context)),
    vscode.commands.registerCommand('codewiki.patterns', () => cmdPatterns(context)),
    vscode.commands.registerCommand('codewiki.generateWiki', () => cmdGenerateWiki()),
    vscode.commands.registerCommand('codewiki.exportWiki', () => cmdExport()),
    vscode.commands.registerCommand('codewiki.status', () => cmdStatus()),
    vscode.commands.registerCommand('codewiki.refresh', () => cmdRefresh()),
    vscode.commands.registerCommand('codewiki.clearDiagnostics', () => diagnostics.clear()),
    vscode.commands.registerCommand('codewiki.goToEntity', (filePath: string, line: number) => goToEntity(filePath, line)),
  )

  // Register webview sidebar panel
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codewiki.usagePanel', new UsagePanelViewProvider(context))
  )

  // Tree providers
  entityTree = new EntityTreeProvider()
  wikiTree = new WikiTreeProvider()
  vscode.window.registerTreeDataProvider('codewiki.entities', entityTree)
  vscode.window.registerTreeDataProvider('codewiki.wikiPages', wikiTree)

  // CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,rb,php,kt,swift}' },
      new CodeWikiCodeLensProvider()
    )
  )

  // Hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,rb,php,kt,swift}' },
      new CodeWikiHoverProvider()
    )
  )

  // Definition provider (ontology-based go-to-definition)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,rb,php,kt,swift}' },
      new CodeWikiDefinitionProvider()
    )
  )

  // Reference provider (ontology-based find-references)
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(
      { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,rb,php,kt,swift}' },
      new CodeWikiReferenceProvider()
    )
  )

  // Document symbol provider (ontology-based outline)
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,rb,php,kt,swift}' },
      new CodeWikiDocumentSymbolProvider(),
      { label: 'CodeWiki Entities' }
    )
  )

  // File watcher for auto re-index on save
  setupFileWatcher(context)

  // Auto-index
  const config = vscode.workspace.getConfiguration('codewiki')
  if (config.get<boolean>('autoIndex', true)) {
    const folders = vscode.workspace.workspaceFolders
    if (folders?.[0]) autoIndex(folders[0].uri.fsPath)
  }

  outputChannel.appendLine('CodeWiki extension activated (v0.5.1)')
}

export function deactivate() {
  if (reindexTimer) clearTimeout(reindexTimer)
  if (fileWatcher) fileWatcher.dispose()
}

// ─── File Watcher ──────────────────────────────────────────────────────────────

function setupFileWatcher(context: vscode.ExtensionContext) {
  fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,rb,php,kt,swift}')

  const debouncedReindex = () => {
    if (reindexTimer) clearTimeout(reindexTimer)
    reindexTimer = setTimeout(() => {
      const pp = getProjectPath()
      if (!pp || !indexed) return
      statusBarItem.text = '$(sync~spin) CodeWiki'
      autoIndex(pp).then(() => {
        outputChannel.appendLine('Auto re-indexed after file change')
      })
    }, 3000)
  }

  fileWatcher.onDidChange(debouncedReindex)
  fileWatcher.onDidCreate(debouncedReindex)
  fileWatcher.onDidDelete(debouncedReindex)
  context.subscriptions.push(fileWatcher)
}

// ─── Navigate to entity ────────────────────────────────────────────────────────

async function goToEntity(filePath: string, line: number) {
  const pp = getProjectPath()
  if (!pp) return
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(pp, filePath)
  try {
    const doc = await vscode.workspace.openTextDocument(absPath)
    const editor = await vscode.window.showTextDocument(doc)
    const pos = new vscode.Position(Math.max(0, line - 1), 0)
    editor.selection = new vscode.Selection(pos, pos)
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
  } catch {
    vscode.window.showWarningMessage(`Cannot open: ${absPath}`)
  }
}

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

function runCliJson(args: string[], projectPath?: string): Promise<Record<string, unknown>> {
  return runCli([...args, '--json'], projectPath).then(({ stdout }) => {
    try { return JSON.parse(stdout) as Record<string, unknown> }
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
    lastEntityCount = (result.totalEntities as number) ?? 0
    lastRelationCount = (result.totalRelations as number) ?? 0
    statusBarItem.text = `$(book) CodeWiki: ${lastEntityCount} ${t('entities')}`
    statusBarItem.tooltip = `${lastEntityCount} ${t('entities')}, ${lastRelationCount} ${t('relations')}`
    statusBarItem.command = 'codewiki.healthCheck'

    // Fetch full entity/relation data for tree view, hover, etc.
    await fetchEntityData(projectPath)

    entityTree?.refresh()
    wikiTree?.refresh()
  } else {
    statusBarItem.text = '$(book) CodeWiki'
    outputChannel.appendLine(`Index failed: ${JSON.stringify(result)}`)
  }
}

async function fetchEntityData(projectPath: string) {
  const result = await runCliJson(['status', '-p', `"${projectPath}"`])
  if (result?.entities && Array.isArray(result.entities)) {
    cachedEntities = result.entities as CliEntity[]
  }
  if (result?.relations && Array.isArray(result.relations)) {
    cachedRelations = result.relations as CliRelation[]
  }
  // Try fetching from the index cache file directly if CLI status doesn't include full data
  if (cachedEntities.length === 0) {
    try {
      const cacheDir = path.join(projectPath, '.codewiki')
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'))
        for (const file of files) {
          const data = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf-8'))
          if (data?.graph?.entities) {
            cachedEntities = data.graph.entities as CliEntity[]
            cachedRelations = (data.graph.relations || []) as CliRelation[]
            break
          }
        }
      }
    } catch { /* cache read is best-effort */ }
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
      let data: Record<string, unknown>
      try { data = JSON.parse(raw) as Record<string, unknown> } catch { data = {} }
      if (!data || data.error) {
        vscode.window.showWarningMessage(t('healthNoData'))
        return
      }
      const health = data.health as Record<string, unknown> | undefined
      if (health?.grade) setGradeStatusBar(health.grade as string)
      // Publish code quality diagnostics
      publishCodeQualityDiagnostics(pp, data)
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
      let data: Record<string, unknown>
      try { data = JSON.parse(raw) as Record<string, unknown> } catch { data = {} }
      if (!data) { vscode.window.showWarningMessage(t('healthNoData')); return }
      const health = data.health as Record<string, unknown> | undefined
      if (health?.grade) setGradeStatusBar(health.grade as string)
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

function publishSecurityDiagnostics(projectRoot: string, data: Record<string, unknown>): number {
  diagnostics.clear()
  const security = data?.security as Record<string, unknown> | undefined
  const findings: Array<Record<string, unknown>> = (security?.findings || []) as Array<Record<string, unknown>>
  if (!findings.length) return 0
  const byFile = new Map<string, vscode.Diagnostic[]>()
  for (const f of findings) {
    if (!f.file) continue
    const abs = path.isAbsolute(f.file as string) ? f.file as string : path.resolve(projectRoot, f.file as string)
    const line = Math.max(0, ((f.line as number) || 1) - 1)
    const range = new vscode.Range(line, 0, line, 200)
    const diag = new vscode.Diagnostic(
      range,
      `[${((f.severity as string) || 'info').toUpperCase()}] ${(f.message as string) || (f.rule as string) || 'security finding'}`,
      SEVERITY_MAP[f.severity as string] ?? vscode.DiagnosticSeverity.Information
    )
    diag.source = 'CodeWiki'
    if (f.rule) diag.code = f.rule as string
    const list = byFile.get(abs) || []
    list.push(diag)
    byFile.set(abs, list)
  }
  for (const [file, diags] of byFile) {
    diagnostics.set(vscode.Uri.file(file), diags)
  }
  return findings.length
}

// ─── Code Quality Diagnostics (dead code, god objects, coupling) ───────────────

function publishCodeQualityDiagnostics(projectRoot: string, data: Record<string, unknown>): number {
  const byFile = new Map<string, vscode.Diagnostic[]>()
  let count = 0

  // Dead code
  const health = data?.health as Record<string, unknown> | undefined
  const deadItems = (health?.deadCode || []) as Array<Record<string, unknown>>
  for (const item of deadItems) {
    if (!item.file && !item.filePath) continue
    const file = (item.file || item.filePath) as string
    const abs = path.isAbsolute(file) ? file : path.resolve(projectRoot, file)
    const line = Math.max(0, ((item.line as number) || 1) - 1)
    const range = new vscode.Range(line, 0, line, 200)
    const diag = new vscode.Diagnostic(range, `${t('deadCodeDiag')}: ${(item.name as string) || ''}`, vscode.DiagnosticSeverity.Hint)
    diag.source = 'CodeWiki'
    diag.code = 'dead-code'
    diag.tags = [vscode.DiagnosticTag.Unnecessary]
    const list = byFile.get(abs) || []
    list.push(diag)
    byFile.set(abs, list)
    count++
  }

  // God objects
  const patterns = data?.patterns as Record<string, unknown> | undefined
  const patternEntities = (patterns?.entities || []) as Array<Record<string, unknown>>
  for (const entity of patternEntities) {
    const antiPatterns = (entity.antiPatterns || []) as string[]
    if (!antiPatterns.length) continue
    const file = (entity.file || entity.filePath) as string
    if (!file) continue
    const abs = path.isAbsolute(file) ? file : path.resolve(projectRoot, file)
    const line = Math.max(0, ((entity.line as number) || 1) - 1)
    const range = new vscode.Range(line, 0, line, 200)
    for (const ap of antiPatterns) {
      let msg = ap
      let severity = vscode.DiagnosticSeverity.Warning
      if (ap === 'GodObject') { msg = `${t('godObjectDiag')}: ${(entity.name as string) || ''}`; severity = vscode.DiagnosticSeverity.Warning }
      else if (ap === 'HighCoupling') { msg = `${t('highCouplingDiag')}: ${(entity.name as string) || ''}`; severity = vscode.DiagnosticSeverity.Information }
      else { msg = `Anti-pattern: ${ap} — ${(entity.name as string) || ''}` }
      const diag = new vscode.Diagnostic(range, msg, severity)
      diag.source = 'CodeWiki'
      diag.code = ap.toLowerCase()
      const list = byFile.get(abs) || []
      list.push(diag)
      byFile.set(abs, list)
      count++
    }
  }

  // Merge with existing diagnostics
  for (const [file, diags] of byFile) {
    const existing = diagnostics.get(vscode.Uri.file(file)) || []
    diagnostics.set(vscode.Uri.file(file), [...existing, ...diags])
  }
  return count
}

// ─── Patterns ──────────────────────────────────────────────────────────────────

async function cmdPatterns(context: vscode.ExtensionContext) {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }
  const raw = await runCliRaw(['report', 'json', '-p', `"${pp}"`])
  let data: Record<string, unknown>
  try { data = JSON.parse(raw) as Record<string, unknown> } catch { data = {} }
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
  const results = result?.results as Array<Record<string, unknown>> | undefined
  if (results?.length) {
    interface SQP extends vscode.QuickPickItem { filePath?: string; line?: number }
    const items: SQP[] = results.map((r) => ({
      label: (r.file || r.entity || r.title) as string,
      description: `Score: ${((r.score as number) * 100).toFixed(0)}%`,
      detail: ((r.snippet as string) || '').substring(0, 200),
      filePath: r.file as string, line: r.line as number,
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
    if (result?.error) { vscode.window.showErrorMessage(`CodeWiki: ${result.error as string}`); return }
    const entity = result.entity as Record<string, unknown> | undefined
    outputChannel.clear()
    outputChannel.appendLine(`=== Pre-Check: ${entityName} ===`)
    outputChannel.appendLine(`Type: ${entity?.type || '?'} | File: ${entity?.file || '?'}:${entity?.line || '?'}`)
    outputChannel.appendLine(`Risk: ${(result.risk as string) || '?'} | Impact: ${(result.impactedEntities as number) || 0} ${t('entities')}, ${(result.impactedFiles as number) || 0} ${t('files')}`)
    const warnings = result.warnings as string[] | undefined
    if (warnings?.length) outputChannel.appendLine(`Warnings: ${warnings.join(', ')}`)
    outputChannel.show()
    if (result.risk === 'HIGH') { vscode.window.showWarningMessage(`HIGH RISK — ${entityName} impacts ${result.impactedEntities as number} entities`) }
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
    outputChannel.appendLine(`Total: ${result.totalEntities as number} ${t('entities')}, ${result.totalFiles as number} ${t('files')}`)
    const byFile = result.byFile as Record<string, Array<Record<string, unknown>>> | undefined
    if (byFile) {
      for (const [f, ents] of Object.entries(byFile)) {
        outputChannel.appendLine(`  ${f}:`)
        for (const e of ents) outputChannel.appendLine(`    - ${e.type as string}: ${e.name as string}`)
      }
    }
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
    const entity = result.entity as Record<string, unknown> | undefined
    outputChannel.clear()
    outputChannel.appendLine(`=== Relations: ${entity?.name || entityName} (${entity?.type || '?'}) ===`)
    const outgoing = result.outgoing as Array<Record<string, unknown>> | undefined
    const incoming = result.incoming as Array<Record<string, unknown>> | undefined
    if (outgoing?.length) { outputChannel.appendLine('Outgoing:'); for (const r of outgoing) outputChannel.appendLine(`  → ${r.type as string} → ${r.target as string}`) }
    if (incoming?.length) { outputChannel.appendLine('Incoming:'); for (const r of incoming) outputChannel.appendLine(`  ← ${r.type as string} ← ${r.source as string}`) }
    outputChannel.show()
  }
}

async function cmdOpenWiki(context: vscode.ExtensionContext) { WikiPanel.createOrShow(context) }

// ─── Generate Wiki ─────────────────────────────────────────────────────────────

async function cmdGenerateWiki() {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('generating'), cancellable: false },
    async () => {
      // First ensure indexed
      if (!indexed) await autoIndex(pp)
      // Call wiki-generate CLI command
      const result = await runCliJson(['wiki-generate', '-p', `"${pp}"`])
      if (result?.success || result?.pages) {
        vscode.window.showInformationMessage(`${t('generated')} (${(result.pages as number) || '?'} pages)`)
        wikiTree?.refresh()
      } else {
        const errMsg = (result?.error as string) || (result?.stderr as string) || ''
        vscode.window.showErrorMessage(`${t('generateFail')}: ${errMsg}`)
        outputChannel.appendLine(`Wiki generation failed: ${JSON.stringify(result)}`)
      }
    }
  )
}

// ─── Knowledge Graph Webview ───────────────────────────────────────────────────

async function cmdShowGraph(context: vscode.ExtensionContext) {
  const pp = getProjectPath()
  if (!pp) { vscode.window.showWarningMessage(t('noWorkspace')); return }

  // If we have no cached entities, try to fetch
  if (cachedEntities.length === 0) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('indexing'), cancellable: false },
      async () => {
        if (!indexed) await autoIndex(pp)
        else await fetchEntityData(pp)
      }
    )
  }

  if (cachedEntities.length === 0) {
    vscode.window.showWarningMessage(t('healthNoData'))
    return
  }

  GraphPanel.createOrShow(context, cachedEntities, cachedRelations)
}

async function cmdAsk() {
  const q = await vscode.window.showInputBox({ prompt: getLang() === 'zh' ? '向代码提问' : 'Ask about your code' })
  if (!q) return
  const result = await runCliJson(['analyze', `"${q}"`, '-p', `"${getProjectPath()}"`])
  if (result) {
    outputChannel.clear()
    outputChannel.appendLine(`=== ${q} ===\n`)
    const entities = result.entities as Array<Record<string, unknown>> | undefined
    if (entities?.length) { for (const e of entities.slice(0, 10)) outputChannel.appendLine(`  ${e.type as string}: ${e.name as string} (${e.file as string}:${e.line as number})`) }
    const searchResults = result.searchResults as Array<Record<string, unknown>> | undefined
    if (searchResults?.length) { outputChannel.appendLine(''); for (const r of searchResults.slice(0, 5)) outputChannel.appendLine(`  ${r.file as string} (${((r.score as number) * 100).toFixed(0)}%)`) }
    outputChannel.show()
  }
}

async function cmdExport() {
  const fmt = await vscode.window.showQuickPick(['markdown', 'html', 'json'], { placeHolder: 'Export format' })
  if (!fmt) return
  const result = await runCliJson(['export', fmt, '-p', `"${getProjectPath()}"`])
  if (result?.success && result.outputPath) {
    const doc = await vscode.workspace.openTextDocument(result.outputPath as string)
    await vscode.window.showTextDocument(doc)
  }
}

async function cmdStatus() {
  const result = await runCliJson(['status', '-p', `"${getProjectPath()}"`])
  if (result) {
    outputChannel.clear()
    outputChannel.appendLine('=== CodeWiki Status ===')
    outputChannel.appendLine(`Indexed: ${result.indexed as boolean} | ${result.totalEntities as number} ${t('entities')} | ${result.totalRelations as number} ${t('relations')} | ${result.totalFiles as number} ${t('files')}`)
    if (result.lastIndexed) outputChannel.appendLine(`Last indexed: ${new Date(result.lastIndexed as number).toLocaleString()}`)
    if (result.cacheFile) outputChannel.appendLine(`Cache: ${result.cacheFile as string}`)
    outputChannel.show()
  }
}

// ─── Health Panel (Webview) ────────────────────────────────────────────────────

class HealthPanel {
  static panel: vscode.WebviewPanel | undefined
  static createOrShow(context: vscode.ExtensionContext, data: Record<string, unknown>, tab?: string) {
    if (HealthPanel.panel) { HealthPanel.panel.reveal(); HealthPanel.panel.webview.html = HealthPanel.html(data, tab); return }
    const panel = vscode.window.createWebviewPanel('codewikiHealth', `CodeWiki ${t('healthTitle')}`, vscode.ViewColumn.One, { enableScripts: true })
    panel.webview.html = HealthPanel.html(data, tab)
    panel.onDidDispose(() => { HealthPanel.panel = undefined })
    HealthPanel.panel = panel
  }

  static html(data: Record<string, unknown>, focusTab?: string): string {
    const lang = getLang()
    const h = (data.health || {}) as Record<string, unknown>
    const s = (data.security || {}) as Record<string, unknown>
    const p = (data.patterns || {}) as Record<string, unknown>
    const gradeColor: Record<string, string> = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' }
    const gc = gradeColor[h.grade as string] || '#888'

    const components = (h.components || []) as Array<Record<string, unknown>>
    const healthHtml = `
      <div class="card">
        <h2>${lang === 'zh' ? '代码健康' : 'Code Health'}</h2>
        <div class="grade" style="color:${gc}">${(h.grade as string) || '?'}</div>
        <p>${t('score')}: ${h.score != null ? ((h.score as number) * 100).toFixed(0) + '/100' : '—'}</p>
        <table>
          ${components.map((c) => `<tr><td>${c.key as string}</td><td>${((c.score as number) * 100).toFixed(0)}%</td><td class="dim">${(c.detail as string) || ''}</td></tr>`).join('')}
        </table>
        ${(h.topCycles as unknown[])?.length ? `<p><b>${t('cycles')}:</b> ${(h.topCycles as unknown[]).length}</p>` : ''}
      </div>`

    const sFindings = (s.findings || []) as Array<Record<string, unknown>>
    const sBySeverity = (s.bySeverity || {}) as Record<string, number>
    const secHtml = `
      <div class="card">
        <h2>${lang === 'zh' ? '安全' : 'Security'}</h2>
        ${s.total ? `
          <p><span class="badge high">${t('secHigh')}: ${sBySeverity.high || 0}</span>
             <span class="badge med">${t('secMed')}: ${sBySeverity.medium || 0}</span>
             <span class="badge low">${t('secLow')}: ${sBySeverity.low || 0}</span></p>
          <p>${s.total as number} ${t('findings')} / ${s.filesScanned as number} ${t('files')}</p>
          <table>${sFindings.slice(0, 20).map((f) => `<tr><td class="badge ${f.severity as string}">${f.severity as string}</td><td>${f.file as string}:${f.line as number}</td><td>${f.message as string}</td></tr>`).join('')}</table>
        ` : `<p>${t('noFindings')}</p>`}
      </div>`

    const pCounts = (p.counts || {}) as Record<string, number>
    const pEntities = (p.entities || []) as Array<Record<string, unknown>>
    const patHtml = `
      <div class="card">
        <h2>${lang === 'zh' ? '设计模式' : 'Design Patterns'}</h2>
        ${p.total ? `
          <p>${t('patterns')}: ${Object.entries(pCounts).filter(([k]) => !['GodObject', 'HighCoupling'].includes(k)).map(([k, v]) => `<span class="badge pat">${k}: ${v}</span>`).join(' ')}</p>
          <p>${t('antiPatterns')}: ${Object.entries(pCounts).filter(([k]) => ['GodObject', 'HighCoupling'].includes(k)).map(([k, v]) => `<span class="badge high">${k}: ${v}</span>`).join(' ') || '—'}</p>
          <table>${pEntities.slice(0, 20).map((e) => `<tr><td>${e.name as string}</td><td>${e.type as string}</td><td>${[...(e.patterns as string[]), ...(e.antiPatterns as string[]).map((a: string) => '⚠ ' + a)].join(', ')}</td></tr>`).join('')}</table>
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
      <script>function showTab(id){document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active')});document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});document.getElementById('tab-'+id).classList.add('active');document.querySelector('[onclick*="'+id+'"]').classList.add('active');}</script>
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
    { cmd: 'codewiki.showGraph', label: lang === 'zh' ? '知识图谱' : 'Knowledge Graph', icon: '🕸️' },
    { cmd: 'codewiki.generateWiki', label: lang === 'zh' ? '生成 Wiki' : 'Generate Wiki', icon: '📝' },
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
    <script>var vscode=acquireVsCodeApi();function run(c){vscode.postMessage({command:c});}</script>
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
      '知识图谱 → 在 VS Code 内可视化代码关系',
      '生成 Wiki → 使用 LLM 生成项目文档',
      '使用面板 → 一键访问所有功能',
    ] : [
      'Initialize → Ensure CLI & MCP config are ready',
      'Index Project → Build ontology graph',
      'Health Check → Grade (A–F), cycles, security, patterns',
      'Semantic Search → Find code by meaning',
      'Pre-check → Analyze impact before modifying',
      'Knowledge Graph → Visualize code relationships in VS Code',
      'Generate Wiki → Use LLM to generate project documentation',
      'Usage Panel → One-click access to all features',
    ]
    return `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:20px;}h1{border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px;}li{margin:6px 0;}</style></head><body>
      <h1>${title}</h1><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>
      <p style="margin-top:20px;opacity:.7;">${lang === 'zh' ? '按 Ctrl+Shift+P 搜索 "CodeWiki" 查看所有命令。' : 'Press Ctrl+Shift+P and type "CodeWiki" to see all commands.'}</p>
    </body></html>`
  }
}

// ─── Graph Panel (Knowledge Graph Webview) ─────────────────────────────────────

class GraphPanel {
  static panel: vscode.WebviewPanel | undefined

  static createOrShow(context: vscode.ExtensionContext, entities: CliEntity[], relations: CliRelation[]) {
    if (GraphPanel.panel) {
      GraphPanel.panel.reveal()
      GraphPanel.panel.webview.html = GraphPanel.html(entities, relations)
      return
    }
    const panel = vscode.window.createWebviewPanel('codewikiGraph', `CodeWiki ${t('graphTitle')}`, vscode.ViewColumn.One, { enableScripts: true })
    panel.webview.html = GraphPanel.html(entities, relations)
    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === 'goToEntity' && msg.filePath && msg.line) {
        vscode.commands.executeCommand('codewiki.goToEntity', msg.filePath, msg.line)
      }
    })
    panel.onDidDispose(() => { GraphPanel.panel = undefined })
    GraphPanel.panel = panel
  }

  static html(entities: CliEntity[], relations: CliRelation[]): string {
    const lang = getLang()
    // Limit to top entities for performance
    const maxNodes = 200
    const limitedEntities = entities.slice(0, maxNodes)
    const entityIds = new Set(limitedEntities.map(e => e.id))
    const limitedRelations = relations.filter(r => entityIds.has(r.source) && entityIds.has(r.target))

    const typeColors: Record<string, string> = {
      Class: '#3b82f6', Interface: '#8b5cf6', Function: '#22c55e', Method: '#10b981',
      Module: '#f59e0b', File: '#6b7280', Component: '#ec4899', Type: '#06b6d4',
      Enum: '#f97316', Variable: '#84cc16', Package: '#d946ef',
    }

    const nodesJson = JSON.stringify(limitedEntities.map(e => ({
      id: e.id, name: e.name, type: e.type, filePath: e.filePath, line: e.line,
      color: typeColors[e.type] || '#888',
    })))
    const linksJson = JSON.stringify(limitedRelations.map(r => ({
      source: r.source, target: r.target, type: r.type,
    })))

    return `<!DOCTYPE html><html><head><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); overflow:hidden; }
      #graph { width:100vw; height:100vh; }
      svg { width:100%; height:100%; }
      .legend { position:fixed; top:10px; right:10px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius:6px; padding:8px 12px; font-size:11px; z-index:10; }
      .legend-item { display:flex; align-items:center; gap:6px; margin:2px 0; }
      .legend-dot { width:10px; height:10px; border-radius:50%; }
      .tooltip { position:fixed; background: var(--vscode-editorHoverWidget-background); border: 1px solid var(--vscode-editorHoverWidget-border); border-radius:4px; padding:6px 10px; font-size:12px; pointer-events:none; z-index:20; display:none; }
      .controls { position:fixed; bottom:10px; left:10px; display:flex; gap:6px; z-index:10; }
      .controls button { padding:4px 10px; border-radius:4px; border:1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor:pointer; font-size:11px; }
      .controls button:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .filter-bar { position:fixed; top:10px; left:10px; display:flex; flex-wrap:wrap; gap:4px; z-index:10; }
      .filter-btn { padding:3px 8px; border-radius:12px; border:1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); color: var(--vscode-foreground); cursor:pointer; font-size:10px; opacity:0.8; }
      .filter-btn.active { opacity:1; font-weight:bold; }
      .stats { position:fixed; bottom:10px; right:10px; font-size:11px; opacity:0.7; z-index:10; }
    </style></head><body>
      <div class="filter-bar" id="filters"></div>
      <div id="graph"></div>
      <div class="tooltip" id="tooltip"></div>
      <div class="controls">
        <button onclick="zoomIn()">+</button>
        <button onclick="zoomOut()">−</button>
        <button onclick="resetZoom()">${lang === 'zh' ? '重置' : 'Reset'}</button>
      </div>
      <div class="stats">${limitedEntities.length} ${t('entities')} · ${limitedRelations.length} ${t('relations')}</div>
      <script>
        var vscode = acquireVsCodeApi();
        var nodes = ${nodesJson};
        var links = ${linksJson};
        var typeColors = ${JSON.stringify(typeColors)};
        var width = window.innerWidth, height = window.innerHeight;
        var activeTypes = new Set(Object.keys(typeColors));

        // Build filter bar
        var filterBar = document.getElementById('filters');
        var typeCounts = {};
        nodes.forEach(function(n) { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1; });
        Object.keys(typeCounts).sort().forEach(function(type) {
          var btn = document.createElement('div');
          btn.className = 'filter-btn active';
          btn.style.borderColor = typeColors[type] || '#888';
          btn.textContent = type + ' (' + typeCounts[type] + ')';
          btn.onclick = function() {
            if (activeTypes.has(type)) { activeTypes.delete(type); btn.classList.remove('active'); }
            else { activeTypes.add(type); btn.classList.add('active'); }
            updateGraph();
          };
          filterBar.appendChild(btn);
        });

        // SVG setup
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        document.getElementById('graph').appendChild(svg);
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svg.appendChild(g);

        var currentZoom = 1, panX = 0, panY = 0;
        function applyTransform() { g.setAttribute('transform', 'translate('+panX+','+panY+') scale('+currentZoom+')'); }
        function zoomIn() { currentZoom *= 1.3; applyTransform(); }
        function zoomOut() { currentZoom /= 1.3; applyTransform(); }
        function resetZoom() { currentZoom = 1; panX = 0; panY = 0; applyTransform(); }

        // Mouse wheel zoom
        svg.addEventListener('wheel', function(e) {
          e.preventDefault();
          var delta = e.deltaY > 0 ? 0.9 : 1.1;
          currentZoom *= delta;
          applyTransform();
        });

        // Pan
        var isPanning = false, startPanX = 0, startPanY = 0;
        svg.addEventListener('mousedown', function(e) {
          if (e.target === svg || e.target === g) { isPanning = true; startPanX = e.clientX - panX; startPanY = e.clientY - panY; }
        });
        svg.addEventListener('mousemove', function(e) {
          if (isPanning) { panX = e.clientX - startPanX; panY = e.clientY - startPanY; applyTransform(); }
        });
        svg.addEventListener('mouseup', function() { isPanning = false; });

        // Simple force layout
        var simNodes = [], simLinks = [];

        function updateGraph() {
          while (g.firstChild) g.removeChild(g.firstChild);
          simNodes = nodes.filter(function(n) { return activeTypes.has(n.type); });
          var nodeIds = new Set(simNodes.map(function(n) { return n.id; }));
          simLinks = links.filter(function(l) { return nodeIds.has(l.source) && nodeIds.has(l.target); });

          // Initial positions
          simNodes.forEach(function(n, i) {
            var angle = (2 * Math.PI * i) / simNodes.length;
            var radius = Math.min(width, height) * 0.35;
            n.x = width/2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 50;
            n.y = height/2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 50;
            n.vx = 0; n.vy = 0;
          });

          // Simple force simulation (runs synchronously for a few iterations)
          var nodeMap = {};
          simNodes.forEach(function(n) { nodeMap[n.id] = n; });
          for (var iter = 0; iter < 100; iter++) {
            // Repulsion
            for (var i = 0; i < simNodes.length; i++) {
              for (var j = i+1; j < simNodes.length; j++) {
                var dx = simNodes[j].x - simNodes[i].x;
                var dy = simNodes[j].y - simNodes[i].y;
                var dist = Math.sqrt(dx*dx + dy*dy) || 1;
                var force = 800 / (dist * dist);
                simNodes[i].vx -= dx/dist * force;
                simNodes[i].vy -= dy/dist * force;
                simNodes[j].vx += dx/dist * force;
                simNodes[j].vy += dy/dist * force;
              }
            }
            // Attraction along links
            simLinks.forEach(function(l) {
              var s = nodeMap[l.source], t = nodeMap[l.target];
              if (!s || !t) return;
              var dx = t.x - s.x, dy = t.y - s.y;
              var dist = Math.sqrt(dx*dx + dy*dy) || 1;
              var force = (dist - 80) * 0.01;
              s.vx += dx/dist * force; s.vy += dy/dist * force;
              t.vx -= dx/dist * force; t.vy -= dy/dist * force;
            });
            // Center gravity
            simNodes.forEach(function(n) {
              n.vx += (width/2 - n.x) * 0.001;
              n.vy += (height/2 - n.y) * 0.001;
              n.x += n.vx * 0.5; n.y += n.vy * 0.5;
              n.vx *= 0.9; n.vy *= 0.9;
            });
          }

          // Draw links
          simLinks.forEach(function(l) {
            var s = nodeMap[l.source], t = nodeMap[l.target];
            if (!s || !t) return;
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', s.x); line.setAttribute('y1', s.y);
            line.setAttribute('x2', t.x); line.setAttribute('y2', t.y);
            line.setAttribute('stroke', '#555'); line.setAttribute('stroke-width', '0.5'); line.setAttribute('opacity', '0.4');
            g.appendChild(line);
          });

          // Draw nodes
          var tooltip = document.getElementById('tooltip');
          simNodes.forEach(function(n) {
            var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', n.x); circle.setAttribute('cy', n.y);
            circle.setAttribute('r', '5'); circle.setAttribute('fill', n.color);
            circle.setAttribute('cursor', 'pointer');
            circle.addEventListener('mouseenter', function(e) {
              tooltip.style.display = 'block';
              tooltip.style.left = (e.clientX + 12) + 'px';
              tooltip.style.top = (e.clientY - 10) + 'px';
              tooltip.innerHTML = '<b>' + n.name + '</b><br>' + n.type + '<br>' + n.filePath + ':' + n.line;
            });
            circle.addEventListener('mouseleave', function() { tooltip.style.display = 'none'; });
            circle.addEventListener('click', function() {
              vscode.postMessage({ command: 'goToEntity', filePath: n.filePath, line: n.line });
            });
            g.appendChild(circle);

            // Label
            var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', n.x + 7); text.setAttribute('y', n.y + 3);
            text.setAttribute('fill', 'var(--vscode-foreground)'); text.setAttribute('font-size', '8');
            text.setAttribute('opacity', '0.7');
            text.textContent = n.name.length > 20 ? n.name.substring(0, 18) + '..' : n.name;
            g.appendChild(text);
          });
        }

        updateGraph();
      </script>
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
    const relPath = vscode.workspace.asRelativePath(document.uri)

    // Find entities in this file from cached data
    const fileEntities = cachedEntities.filter(e =>
      e.filePath === relPath || e.filePath === document.uri.fsPath ||
      e.filePath.endsWith('/' + relPath) || relPath.endsWith(e.filePath)
    )

    if (fileEntities.length > 0) {
      // Use cached entity data for accurate CodeLens
      for (const entity of fileEntities) {
        if (entity.type === 'File' || entity.type === 'Module') continue
        const line = Math.max(0, entity.line - 1)
        if (line >= document.lineCount) continue
        const pos = new vscode.Position(line, 0)
        const relCount = cachedRelations.filter(r => r.source === entity.id || r.target === entity.id).length
        const label = `$(symbol-${entityTypeToIcon(entity.type)}) ${entity.type} · ${relCount} relations`
        lenses.push(new vscode.CodeLens(new vscode.Range(pos, pos), {
          title: label,
          command: 'codewiki.preCheck',
        }))
      }
    } else {
      // Fallback: regex-based CodeLens
      const patterns = [/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g, /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, /(?:export\s+)?interface\s+(\w+)/g]
      for (const pattern of patterns) {
        let match
        while ((match = pattern.exec(text)) !== null) {
          const pos = document.positionAt(match.index)
          lenses.push(new vscode.CodeLens(new vscode.Range(pos, pos), { title: `$(search) Pre-check "${match[1]}"`, command: 'codewiki.preCheck' }))
        }
      }
    }
    return lenses.slice(0, 30)
  }
}

function entityTypeToIcon(type: string): string {
  const map: Record<string, string> = {
    Class: 'class', Interface: 'interface', Function: 'method', Method: 'method',
    Type: 'structure', Enum: 'enum', Variable: 'variable', Component: 'namespace',
    Module: 'namespace', File: 'file', Package: 'package',
  }
  return map[type] || 'misc'
}

// ─── Hover Provider ────────────────────────────────────────────────────────────

class CodeWikiHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!indexed || cachedEntities.length === 0) return undefined

    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) return undefined
    const word = document.getText(wordRange)
    if (word.length < 2) return undefined

    // Find matching entity
    const entity = cachedEntities.find(e => e.name === word)
    if (!entity) return undefined

    const relCount = cachedRelations.filter(r => r.source === entity.id || r.target === entity.id).length
    const outgoing = cachedRelations.filter(r => r.source === entity.id)
    const incoming = cachedRelations.filter(r => r.target === entity.id)

    const lang = getLang()
    const lines: string[] = [
      `**CodeWiki** — \`${entity.type}\` **${entity.name}**`,
      '',
      `📍 \`${entity.filePath}:${entity.line}\``,
      '',
      `🔗 ${relCount} ${lang === 'zh' ? '条关系' : 'relations'} (${outgoing.length} ${lang === 'zh' ? '出' : 'out'} / ${incoming.length} ${lang === 'zh' ? '入' : 'in'})`,
    ]

    if (entity.signature) {
      lines.push('', '```', entity.signature, '```')
    }

    if (outgoing.length > 0) {
      lines.push('', `**${lang === 'zh' ? '出向关系' : 'Outgoing'}:**`)
      for (const r of outgoing.slice(0, 5)) {
        const target = cachedEntities.find(e => e.id === r.target)
        lines.push(`- \`${r.type}\` → ${target?.name || r.target}`)
      }
      if (outgoing.length > 5) lines.push(`- _...${outgoing.length - 5} more_`)
    }

    if (incoming.length > 0) {
      lines.push('', `**${lang === 'zh' ? '入向关系' : 'Incoming'}:**`)
      for (const r of incoming.slice(0, 5)) {
        const source = cachedEntities.find(e => e.id === r.source)
        lines.push(`- ${source?.name || r.source} → \`${r.type}\``)
      }
      if (incoming.length > 5) lines.push(`- _...${incoming.length - 5} more_`)
    }

    const md = new vscode.MarkdownString(lines.join('\n'))
    md.isTrusted = true
    return new vscode.Hover(md, wordRange)
  }
}

// ─── Tree Providers ────────────────────────────────────────────────────────────

class WikiTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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

    const lang = getLang()

    // Check if wiki has been generated by looking for exported wiki files
    const pp = getProjectPath()
    if (pp) {
      const wikiDir = path.join(pp, '.codewiki', 'wiki')
      try {
        if (fs.existsSync(wikiDir)) {
          const pages = fs.readdirSync(wikiDir).filter(f => f.endsWith('.md')).sort()
          if (pages.length > 0) {
            return pages.map(page => {
              const name = page.replace(/\.md$/, '').replace(/-/g, ' ').replace(/^\d+-/, '')
              const ti = new vscode.TreeItem(name)
              ti.iconPath = new vscode.ThemeIcon('file-text')
              ti.command = {
                command: 'vscode.open',
                title: '',
                arguments: [vscode.Uri.file(path.join(wikiDir, page))],
              }
              ti.tooltip = page
              return ti
            })
          }
        }
      } catch { /* best effort */ }
    }

    // Fallback: static wiki page links
    const staticPages = [
      { label: lang === 'zh' ? '项目概览' : 'Project Overview', icon: 'home' },
      { label: lang === 'zh' ? '架构' : 'Architecture', icon: 'type-hierarchy' },
      { label: lang === 'zh' ? '核心模块' : 'Core Modules', icon: 'extensions' },
      { label: lang === 'zh' ? 'API 参考' : 'API Reference', icon: 'references' },
    ]
    return staticPages.map(p => {
      const ti = new vscode.TreeItem(p.label)
      ti.iconPath = new vscode.ThemeIcon(p.icon)
      ti.command = { command: 'codewiki.openWiki', title: '' }
      return ti
    })
  }
}

class EntityTreeProvider implements vscode.TreeDataProvider<EntityTreeItem> {
  private _onDidChange = new vscode.EventEmitter<EntityTreeItem | undefined>()
  readonly onDidChangeTreeData = this._onDidChange.event
  refresh() { this._onDidChange.fire(undefined) }

  getTreeItem(e: EntityTreeItem) { return e }

  getChildren(element?: EntityTreeItem): EntityTreeItem[] {
    if (!indexed) {
      const ti = new EntityTreeItem(t('notIndexed'), vscode.TreeItemCollapsibleState.None)
      ti.command = { command: 'codewiki.init', title: '' }
      ti.iconPath = new vscode.ThemeIcon('rocket')
      return [ti]
    }

    // Root level: show entity type groups
    if (!element) {
      if (cachedEntities.length === 0) {
        // Fallback summary
        const summary = new EntityTreeItem(`${lastEntityCount} ${t('entities')}`, vscode.TreeItemCollapsibleState.None)
        summary.iconPath = new vscode.ThemeIcon('graph')
        summary.command = { command: 'codewiki.status', title: '' }
        return [summary]
      }

      // Group entities by type
      const groups = new Map<string, CliEntity[]>()
      for (const e of cachedEntities) {
        const list = groups.get(e.type) || []
        list.push(e)
        groups.set(e.type, list)
      }

      const typeOrder = ['Class', 'Interface', 'Function', 'Method', 'Component', 'Type', 'Enum', 'Module', 'Variable', 'File']
      const sorted = [...groups.entries()].sort((a, b) => {
        const ia = typeOrder.indexOf(a[0]), ib = typeOrder.indexOf(b[0])
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      })

      const items: EntityTreeItem[] = []

      // Summary item
      const summary = new EntityTreeItem(
        `${cachedEntities.length} ${t('entities')} · ${cachedRelations.length} ${t('relations')}`,
        vscode.TreeItemCollapsibleState.None
      )
      summary.iconPath = new vscode.ThemeIcon('graph')
      summary.command = { command: 'codewiki.status', title: '' }
      items.push(summary)

      for (const [type, ents] of sorted) {
        if (type === 'File') continue // Skip File entities for cleaner tree
        const label = entityTypeLabel(type)
        const ti = new EntityTreeItem(`${label} (${ents.length})`, vscode.TreeItemCollapsibleState.Collapsed)
        ti.iconPath = new vscode.ThemeIcon(`symbol-${entityTypeToIcon(type)}`)
        ti.entityType = type
        items.push(ti)
      }
      return items
    }

    // Child level: show entities of a specific type
    if (element.entityType) {
      const entities = cachedEntities.filter(e => e.type === element.entityType)
      return entities.slice(0, 100).map(e => {
        const ti = new EntityTreeItem(e.name, vscode.TreeItemCollapsibleState.None)
        ti.description = e.filePath
        ti.tooltip = `${e.type}: ${e.name}\n${e.filePath}:${e.line}${e.signature ? '\n' + e.signature : ''}`
        ti.iconPath = new vscode.ThemeIcon(`symbol-${entityTypeToIcon(e.type)}`)
        ti.command = {
          command: 'codewiki.goToEntity',
          title: 'Go to entity',
          arguments: [e.filePath, e.line],
        }
        return ti
      })
    }

    return []
  }
}

class EntityTreeItem extends vscode.TreeItem {
  entityType?: string
}

function entityTypeLabel(type: string): string {
  const keyMap: Record<string, string> = {
    Class: 'classes', Interface: 'interfaces', Function: 'functions', Method: 'methods',
    Type: 'types', Enum: 'enums', Module: 'modules', Component: 'components',
    Variable: 'variables',
  }
  const key = keyMap[type]
  return key ? t(key) : type
}

// ─── Definition Provider ───────────────────────────────────────────────────────

class CodeWikiDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
    if (!indexed || cachedEntities.length === 0) return undefined

    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) return undefined
    const word = document.getText(wordRange)
    if (word.length < 2) return undefined

    const pp = getProjectPath()
    if (!pp) return undefined

    // Find the entity by name
    const entity = cachedEntities.find(e => e.name === word && e.type !== 'File')
    if (!entity) return undefined

    // Don't provide if cursor is already at the definition
    const relPath = vscode.workspace.asRelativePath(document.uri)
    if ((entity.filePath === relPath || entity.filePath.endsWith('/' + relPath) || relPath.endsWith(entity.filePath)) && entity.line === position.line + 1) {
      return undefined
    }

    const absPath = path.isAbsolute(entity.filePath) ? entity.filePath : path.resolve(pp, entity.filePath)
    const pos = new vscode.Position(Math.max(0, entity.line - 1), 0)
    return [new vscode.Location(vscode.Uri.file(absPath), pos)]
  }
}

// ─── Reference Provider ────────────────────────────────────────────────────────

class CodeWikiReferenceProvider implements vscode.ReferenceProvider {
  provideReferences(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
    if (!indexed || cachedEntities.length === 0) return undefined

    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) return undefined
    const word = document.getText(wordRange)
    if (word.length < 2) return undefined

    const pp = getProjectPath()
    if (!pp) return undefined

    // Find the entity by name
    const entity = cachedEntities.find(e => e.name === word)
    if (!entity) return undefined

    const locations: vscode.Location[] = []

    // Entity definition itself
    const defPath = path.isAbsolute(entity.filePath) ? entity.filePath : path.resolve(pp, entity.filePath)
    locations.push(new vscode.Location(vscode.Uri.file(defPath), new vscode.Position(Math.max(0, entity.line - 1), 0)))

    // Incoming relations (entities that reference this entity)
    const incoming = cachedRelations.filter(r => r.target === entity.id)
    for (const rel of incoming) {
      const sourceEntity = cachedEntities.find(e => e.id === rel.source)
      if (!sourceEntity) continue
      const srcPath = path.isAbsolute(sourceEntity.filePath) ? sourceEntity.filePath : path.resolve(pp, sourceEntity.filePath)
      locations.push(new vscode.Location(vscode.Uri.file(srcPath), new vscode.Position(Math.max(0, sourceEntity.line - 1), 0)))
    }

    // Outgoing relations (entities this entity references)
    const outgoing = cachedRelations.filter(r => r.source === entity.id)
    for (const rel of outgoing) {
      const targetEntity = cachedEntities.find(e => e.id === rel.target)
      if (!targetEntity) continue
      const tgtPath = path.isAbsolute(targetEntity.filePath) ? targetEntity.filePath : path.resolve(pp, targetEntity.filePath)
      locations.push(new vscode.Location(vscode.Uri.file(tgtPath), new vscode.Position(Math.max(0, targetEntity.line - 1), 0)))
    }

    // Deduplicate by file + line
    const seen = new Set<string>()
    return locations.filter(loc => {
      const key = `${loc.uri.fsPath}:${loc.range.start.line}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}

// ─── Document Symbol Provider ──────────────────────────────────────────────────

function entityTypeToSymbolKind(type: string): vscode.SymbolKind {
  const map: Record<string, vscode.SymbolKind> = {
    Class: vscode.SymbolKind.Class,
    Interface: vscode.SymbolKind.Interface,
    Function: vscode.SymbolKind.Function,
    Method: vscode.SymbolKind.Method,
    Type: vscode.SymbolKind.TypeParameter,
    Enum: vscode.SymbolKind.Enum,
    Variable: vscode.SymbolKind.Variable,
    Module: vscode.SymbolKind.Module,
    Component: vscode.SymbolKind.Class,
    Package: vscode.SymbolKind.Package,
    File: vscode.SymbolKind.File,
  }
  return map[type] ?? vscode.SymbolKind.Object
}

class CodeWikiDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    if (!indexed || cachedEntities.length === 0) return []

    const relPath = vscode.workspace.asRelativePath(document.uri)
    const fileEntities = cachedEntities.filter(e =>
      e.type !== 'File' && (
        e.filePath === relPath || e.filePath === document.uri.fsPath ||
        e.filePath.endsWith('/' + relPath) || relPath.endsWith(e.filePath)
      )
    )

    if (fileEntities.length === 0) return []

    return fileEntities.map(e => {
      const line = Math.max(0, e.line - 1)
      const endLine = e.endLine ? Math.max(line, e.endLine - 1) : line
      const range = new vscode.Range(line, 0, endLine, 0)
      const relCount = cachedRelations.filter(r => r.source === e.id || r.target === e.id).length
      const detail = `${e.type}${relCount > 0 ? ` · ${relCount} relations` : ''}`
      return new vscode.DocumentSymbol(e.name, detail, entityTypeToSymbolKind(e.type), range, range)
    })
  }
}
