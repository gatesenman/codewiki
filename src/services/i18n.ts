/**
 * Internationalization (i18n) system for CodeWiki
 * Supports Chinese (zh) and English (en)
 */

import type { OntologyEntityType } from '../types'

export type Locale = 'en' | 'zh'

export interface I18nStrings {
  // App
  appName: string
  appDescription: string
  appWindowTitle: string

  // Navigation
  navWiki: string
  navGraph: string
  navSearch: string
  navChat: string
  navAgent: string

  // TopBar
  home: string
  settings: string
  reindex: string
  topShowSidebar: string
  topHideSidebar: string
  topBackToProjects: string
  topReindexTitle: string
  topGenerateWiki: string
  topConfigureApiKey: string
  loadingGeneratingWiki: string
  loadingReindexing: string

  // Welcome Screen
  welcomeTitle: string
  welcomeSubtitle: string
  welcomeDescription: string
  openFolder: string
  recentProjects: string
  noRecentProjects: string
  featOntology: string
  featSemantic: string
  featGraph: string
  featImpact: string
  welcomeOpenLocal: string
  welcomeOpenLocalDesc: string
  welcomeGithub: string
  welcomeGo: string
  welcomeRemoveRecent: string
  loadingIndexing: string
  loadingFetching: string
  errInvalidGithubUrl: string
  errIndexFailed: string
  errFetchFailed: string
  errOpenFailed: string

  // Wiki Viewer
  wikiTitle: string
  wikiGenerating: string
  wikiNoContent: string
  wikiRegenerate: string
  wikiNoneTitle: string
  wikiNoneDescBefore: string
  wikiGenerateBtnLabel: string
  wikiNoneDescAfter: string
  wikiSourceFiles: string
  mermaidRaw: string
  mermaidRenderFailed: string
  qualityLabel: string
  qualityCheckTitle: string
  qualityStructureTitle: string

  // Knowledge Graph
  graphTitle: string
  graphFilter: string
  graphNoData: string
  graphEntities: string
  graphRelations: string
  graphEmpty: string
  graphAllEntities: string

  // Search
  searchPlaceholder: string
  searchResults: string
  searchNoResults: string
  searchEntity: string
  searchCode: string
  searchWiki: string
  searchButton: string
  searchAll: string
  searchEntities: string
  searchMatch: string

  // Chat
  chatTitle: string
  chatPlaceholder: string
  chatSend: string
  chatThinking: string
  chatHeaderTitle: string
  chatClear: string
  chatEmptyTitle: string
  chatEmptyDesc: string
  chatErrorSuffix: string
  chatErrorFallback: string
  chatSuggestion1: string
  chatSuggestion2: string
  chatSuggestion3: string
  chatSuggestion4: string

  // Code Agent
  agentTitle: string
  agentPlaceholder: string
  agentAnalyze: string
  agentApply: string
  agentRollback: string
  agentRisk: string
  agentImpact: string
  agentBadge: string
  agentHeaderDesc: string
  agentInKnowledgeGraph: string
  agentAnalyzing: string
  agentAnalyzePlan: string
  agentAnalysisTitle: string
  agentImpactedFiles: string
  agentProposedMods: string
  agentApplyAll: string
  agentRemaining: string
  agentApplied: string
  agentLinesLabel: string
  agentOriginal: string
  agentModified: string
  agentWarnings: string
  agentEmptyTitle: string
  agentEmptyDesc: string
  agentSuggestion1: string
  agentSuggestion2: string
  agentSuggestion3: string
  agentSuggestion4: string
  agentApplyFailed: string
  agentAnalysisFailed: string
  agentFailedToApply: string

  // Entity Detail Panel
  entityInfo: string
  entitySource: string
  entityRelations: string
  entityImpact: string
  entityType: string
  entityName: string
  entityFile: string
  entityLine: string
  entityLines: string
  entitySignature: string
  entityDescription: string
  entityProperties: string
  entityDetails: string
  entityConnections: string
  entityIncoming: string
  entityOutgoing: string
  entityAffected: string
  entityDepth: string
  entityNoRelations: string
  entityNoRelationsForEntity: string
  entityMayBeAffected: string
  entityNoImpact: string
  entityCopySource: string
  entityLoadingSource: string
  entityNoSourceBrowser: string
  entitySourcePreviewElectron: string
  entityCopiedClipboard: string

  // Settings
  settingsTitle: string
  settingsAi: string
  settingsIndexing: string
  settingsOntology: string
  settingsSearch: string
  settingsInterface: string
  settingsBehavior: string
  settingsWiki: string
  settingsReset: string
  settingsSave: string
  settingsCancel: string
  settingsProvider: string
  settingsModel: string
  settingsApiKey: string
  settingsApiKeyOptional: string
  settingsApiKeyPlaceholder: string
  settingsApiBaseUrl: string
  settingsOptional: string
  settingsTemperature: string
  settingsTemperatureDesc: string
  settingsMaxTokens: string
  settingsMaxTokensDesc: string
  settingsContextWindow: string
  settingsContextWindowDesc: string
  settingsStreamResponse: string
  settingsStreamResponseDesc: string
  settingsTheme: string
  settingsThemeDesc: string
  settingsLanguage: string
  settingsLanguageDesc: string
  settingsFontSize: string
  settingsFontSizeDesc: string
  settingsAutoSave: string
  settingsThemeDark: string
  settingsThemeLight: string
  settingsThemeSystem: string
  settingsMaxDepth: string
  settingsMaxDepthDesc: string
  settingsMaxFileSize: string
  settingsMaxFileSizeDesc: string
  settingsAutoReindex: string
  settingsAutoReindexDesc: string
  settingsFileExtensions: string
  settingsIgnoredDirs: string
  settingsImpactDepth: string
  settingsImpactDepthDesc: string
  settingsWarnEntities: string
  settingsWarnEntitiesDesc: string
  settingsWarnFiles: string
  settingsWarnFilesDesc: string
  settingsExtractDecorators: string
  settingsExtractDecoratorsDesc: string
  settingsExtractArrow: string
  settingsExtractArrowDesc: string
  settingsWikiStyle: string
  settingsWikiStyleDesc: string
  settingsPageCount: string
  settingsPageCountDesc: string
  settingsIncludeMermaid: string
  settingsIncludeMermaidDesc: string
  settingsAutoGenerate: string
  settingsAutoGenerateDesc: string
  settingsMaxResults: string
  settingsMaxResultsDesc: string
  settingsMinScore: string
  settingsMinScoreDesc: string
  settingsSnippetLength: string
  settingsSnippetLengthDesc: string
  settingsKnowledgeGraph: string
  settingsForceStrength: string
  settingsForceStrengthDesc: string
  settingsLinkDistance: string
  settingsLinkDistanceDesc: string
  settingsMaxNodes: string
  settingsMaxNodesDesc: string
  settingsSidebarWidth: string
  settingsSidebarWidthDesc: string
  settingsSidebarPosition: string
  settingsSidebarPositionDesc: string
  settingsPosLeft: string
  settingsPosRight: string
  settingsShowLineNumbers: string
  settingsShowLineNumbersDesc: string
  settingsWordWrap: string
  settingsWordWrapDesc: string
  settingsAutoSaveDesc: string
  settingsAutoSaveInterval: string
  settingsAutoSaveIntervalDesc: string
  settingsConfirmApply: string
  settingsConfirmApplyDesc: string
  settingsRememberProject: string
  settingsRememberProjectDesc: string
  settingsMaxRecent: string
  settingsMaxRecentDesc: string
  settingsNotifications: string
  settingsShowProgress: string
  settingsShowProgressDesc: string
  settingsImpactWarning: string
  settingsImpactWarningDesc: string

  // Sidebar
  sidebarWikiPages: string
  sidebarNoWikiPages: string
  sidebarGenerateHint: string
  sidebarCodeEntities: string
  footerEntities: string
  footerRelations: string
  footerPages: string
  more: string

  // Status
  statusIndexing: string
  statusReady: string
  statusError: string
  statusEntities: string
  statusFiles: string

  // General
  close: string
  cancel: string
  confirm: string
  loading: string
  error: string
  success: string
  warning: string
  copy: string
  copied: string
  open: string
  delete: string
  edit: string
  save: string
  export: string
  import_: string
}

const en: I18nStrings = {
  appName: 'CodeWiki',
  appDescription: 'AI-powered code knowledge base with ontology-based semantic model',
  appWindowTitle: 'CodeWiki - AI Code Knowledge Base',

  navWiki: 'Wiki',
  navGraph: 'Graph',
  navSearch: 'Search',
  navChat: 'Chat',
  navAgent: 'Agent',

  home: 'Home',
  settings: 'Settings',
  reindex: 'Re-index',
  topShowSidebar: 'Show sidebar',
  topHideSidebar: 'Hide sidebar',
  topBackToProjects: 'Back to projects',
  topReindexTitle: 'Re-index project',
  topGenerateWiki: 'Generate Wiki',
  topConfigureApiKey: 'Please configure your API key in Settings first.',
  loadingGeneratingWiki: 'Generating wiki...',
  loadingReindexing: 'Re-indexing project...',

  welcomeTitle: 'Welcome to CodeWiki',
  welcomeSubtitle: 'Select a project folder to get started',
  welcomeDescription: 'An AI code knowledge base based on an ontology semantic model. Generate project documentation and knowledge graphs for precise code analysis and modification.',
  openFolder: 'Open Project Folder',
  recentProjects: 'Recent Projects',
  noRecentProjects: 'No recent projects',
  featOntology: 'Ontology Model',
  featSemantic: 'Semantic Search',
  featGraph: 'Knowledge Graph',
  featImpact: 'Impact Analysis',
  welcomeOpenLocal: 'Open Local Folder',
  welcomeOpenLocalDesc: 'Select a local project folder to automatically analyze the code structure and generate wiki documentation.',
  welcomeGithub: 'GitHub Repository',
  welcomeGo: 'Go',
  welcomeRemoveRecent: 'Remove from recent',
  loadingIndexing: 'Indexing project...',
  loadingFetching: 'Fetching repository...',
  errInvalidGithubUrl: 'Please enter a valid GitHub URL',
  errIndexFailed: 'Failed to index project',
  errFetchFailed: 'Failed to fetch repository',
  errOpenFailed: 'Failed to open project',

  wikiTitle: 'Wiki',
  wikiGenerating: 'Generating wiki documentation...',
  wikiNoContent: 'No wiki content yet. Index a project to generate documentation.',
  wikiRegenerate: 'Regenerate',
  wikiNoneTitle: 'No Wiki Generated Yet',
  wikiNoneDescBefore: 'Click ',
  wikiGenerateBtnLabel: '"Generate Wiki"',
  wikiNoneDescAfter: ' in the top bar to create AI-powered documentation for your project. You can also configure your LLM provider in Settings.',
  wikiSourceFiles: 'source files',
  mermaidRaw: 'Diagram (raw)',
  mermaidRenderFailed: 'Failed to render diagram',
  qualityLabel: 'Quality',
  qualityCheckTitle: 'Documentation quality check',
  qualityStructureTitle: 'Structure check',

  graphTitle: 'Knowledge Graph',
  graphFilter: 'Filter by type',
  graphNoData: 'No ontology data. Index a project first.',
  graphEntities: 'Entities',
  graphRelations: 'Relations',
  graphEmpty: 'No code entities found. Index a project to see the knowledge graph.',
  graphAllEntities: 'All Entities',

  searchPlaceholder: 'Search code, wiki, entities...',
  searchResults: 'Results',
  searchNoResults: 'No results found',
  searchEntity: 'Entity',
  searchCode: 'Code',
  searchWiki: 'Wiki',
  searchButton: 'Search',
  searchAll: 'All',
  searchEntities: 'Entities',
  searchMatch: 'match',

  chatTitle: 'Ask about Code',
  chatPlaceholder: 'Ask about your code...',
  chatSend: 'Send',
  chatThinking: 'Thinking...',
  chatHeaderTitle: 'Ask about your code',
  chatClear: 'Clear chat',
  chatEmptyTitle: 'Ask anything about your codebase',
  chatEmptyDesc: 'Uses ontology-based semantic search and RAG to provide accurate, grounded answers about your code.',
  chatErrorSuffix: 'Check your API key in Settings.',
  chatErrorFallback: 'Failed to get response',
  chatSuggestion1: 'How is authentication handled?',
  chatSuggestion2: 'Explain the data flow',
  chatSuggestion3: 'What design patterns are used?',
  chatSuggestion4: 'Show the main entry point',

  agentTitle: 'Code Agent',
  agentPlaceholder: 'Describe the code modification...',
  agentAnalyze: 'Analyze',
  agentApply: 'Apply',
  agentRollback: 'Rollback',
  agentRisk: 'Risk',
  agentImpact: 'Impact',
  agentBadge: 'Ontology-Constrained',
  agentHeaderDesc: 'Precise code modifications using ontology-based impact analysis. Prevents hallucination by verifying all changes against the code knowledge graph.',
  agentInKnowledgeGraph: 'in knowledge graph',
  agentAnalyzing: 'Analyzing...',
  agentAnalyzePlan: 'Analyze & Plan',
  agentAnalysisTitle: 'Analysis',
  agentImpactedFiles: 'Impacted Files',
  agentProposedMods: 'Proposed Modifications',
  agentApplyAll: 'Apply All',
  agentRemaining: 'remaining',
  agentApplied: 'Applied',
  agentLinesLabel: 'lines',
  agentOriginal: 'Original',
  agentModified: 'Modified',
  agentWarnings: 'Warnings',
  agentEmptyTitle: 'Ontology-Constrained Code Agent',
  agentEmptyDesc: 'Describe the code change you want. The agent will analyze the ontology graph to identify all affected entities and propose precise modifications without hallucination.',
  agentSuggestion1: 'Add input validation to the main form handler',
  agentSuggestion2: 'Refactor the database query functions into a repository pattern',
  agentSuggestion3: 'Add error handling to all API endpoints',
  agentSuggestion4: 'Rename UserService to AccountService and update all references',
  agentApplyFailed: 'Apply failed',
  agentAnalysisFailed: 'Analysis failed',
  agentFailedToApply: 'Failed to apply: ',

  entityInfo: 'Info',
  entitySource: 'Source',
  entityRelations: 'Relations',
  entityImpact: 'Impact',
  entityType: 'Type',
  entityName: 'Name',
  entityFile: 'File',
  entityLine: 'Line',
  entityLines: 'Lines',
  entitySignature: 'Signature',
  entityDescription: 'Description',
  entityProperties: 'Properties',
  entityDetails: 'Details',
  entityConnections: 'Connections',
  entityIncoming: 'Incoming',
  entityOutgoing: 'Outgoing',
  entityAffected: 'Affected Entities',
  entityDepth: 'Depth',
  entityNoRelations: 'No relations found',
  entityNoRelationsForEntity: 'No relations found for this entity.',
  entityMayBeAffected: 'may be affected by changes',
  entityNoImpact: 'No downstream impact detected (isolated entity).',
  entityCopySource: 'Copy source',
  entityLoadingSource: 'Loading source code...',
  entityNoSourceBrowser: 'No source available in browser mode.',
  entitySourcePreviewElectron: 'Source preview works in Electron desktop app.',
  entityCopiedClipboard: 'Copied to clipboard!',

  settingsTitle: 'Settings',
  settingsAi: 'AI',
  settingsIndexing: 'Indexing',
  settingsOntology: 'Ontology',
  settingsSearch: 'Search',
  settingsInterface: 'Interface',
  settingsBehavior: 'Behavior',
  settingsWiki: 'Wiki',
  settingsReset: 'Reset to Defaults',
  settingsSave: 'Save Settings',
  settingsCancel: 'Cancel',
  settingsProvider: 'LLM Provider',
  settingsModel: 'Model',
  settingsApiKey: 'API Key',
  settingsApiKeyOptional: 'optional',
  settingsApiKeyPlaceholder: 'Enter your {provider} API key...',
  settingsApiBaseUrl: 'API Base URL',
  settingsOptional: 'optional',
  settingsTemperature: 'Temperature',
  settingsTemperatureDesc: 'Controls randomness. Lower = more focused.',
  settingsMaxTokens: 'Max Tokens',
  settingsMaxTokensDesc: 'Maximum response length.',
  settingsContextWindow: 'Context Window',
  settingsContextWindowDesc: 'Max characters per file sent to LLM.',
  settingsStreamResponse: 'Stream Response',
  settingsStreamResponseDesc: 'Enable streaming output.',
  settingsTheme: 'Theme',
  settingsThemeDesc: 'Application color theme.',
  settingsLanguage: 'Language',
  settingsLanguageDesc: 'Interface language.',
  settingsFontSize: 'Font Size',
  settingsFontSizeDesc: 'Base font size in pixels.',
  settingsAutoSave: 'Auto Save',
  settingsThemeDark: 'Dark',
  settingsThemeLight: 'Light',
  settingsThemeSystem: 'System',
  settingsMaxDepth: 'Max Directory Depth',
  settingsMaxDepthDesc: 'How deep to traverse folders.',
  settingsMaxFileSize: 'Max File Size',
  settingsMaxFileSizeDesc: 'Skip files larger than this (bytes).',
  settingsAutoReindex: 'Auto Re-index',
  settingsAutoReindexDesc: 'Automatically rebuild index on file changes.',
  settingsFileExtensions: 'File Extensions',
  settingsIgnoredDirs: 'Ignored Directories',
  settingsImpactDepth: 'Impact Analysis Depth',
  settingsImpactDepthDesc: 'BFS traversal depth for impact analysis.',
  settingsWarnEntities: 'Warning: Entity Count',
  settingsWarnEntitiesDesc: 'Warn when impact exceeds this many entities.',
  settingsWarnFiles: 'Warning: File Count',
  settingsWarnFilesDesc: 'Warn when impact spans more than this many files.',
  settingsExtractDecorators: 'Extract Decorators',
  settingsExtractDecoratorsDesc: 'Include decorators in ontology extraction.',
  settingsExtractArrow: 'Extract Arrow Functions',
  settingsExtractArrowDesc: 'Include arrow functions and React components.',
  settingsWikiStyle: 'Documentation Style Template',
  settingsWikiStyleDesc: 'Choose the prompt style for wiki generation. Different styles produce different document structures and levels of detail.',
  settingsPageCount: 'Page Count',
  settingsPageCountDesc: 'Target number of wiki pages to generate.',
  settingsIncludeMermaid: 'Include Mermaid Diagrams',
  settingsIncludeMermaidDesc: 'Generate architecture/flow diagrams in the wiki.',
  settingsAutoGenerate: 'Auto-generate on Open',
  settingsAutoGenerateDesc: 'Automatically generate the wiki after indexing.',
  settingsMaxResults: 'Max Results',
  settingsMaxResultsDesc: 'Maximum number of search results.',
  settingsMinScore: 'Min Score',
  settingsMinScoreDesc: 'Minimum similarity threshold (0-1).',
  settingsSnippetLength: 'Snippet Length',
  settingsSnippetLengthDesc: 'Max characters shown per result snippet.',
  settingsKnowledgeGraph: 'Knowledge Graph',
  settingsForceStrength: 'Force Strength',
  settingsForceStrengthDesc: 'Repulsion between nodes.',
  settingsLinkDistance: 'Link Distance',
  settingsLinkDistanceDesc: 'Distance between connected nodes.',
  settingsMaxNodes: 'Max Nodes',
  settingsMaxNodesDesc: 'Maximum nodes to render.',
  settingsSidebarWidth: 'Sidebar Width',
  settingsSidebarWidthDesc: 'Sidebar width in pixels.',
  settingsSidebarPosition: 'Sidebar Position',
  settingsSidebarPositionDesc: 'Which side to show the sidebar.',
  settingsPosLeft: 'Left',
  settingsPosRight: 'Right',
  settingsShowLineNumbers: 'Show Line Numbers',
  settingsShowLineNumbersDesc: 'Show line numbers in code view.',
  settingsWordWrap: 'Word Wrap',
  settingsWordWrapDesc: 'Wrap long lines in code view.',
  settingsAutoSaveDesc: 'Automatically save project data.',
  settingsAutoSaveInterval: 'Auto Save Interval',
  settingsAutoSaveIntervalDesc: 'Save interval in seconds.',
  settingsConfirmApply: 'Confirm Before Apply',
  settingsConfirmApplyDesc: 'Show confirmation before applying code changes.',
  settingsRememberProject: 'Remember Last Project',
  settingsRememberProjectDesc: 'Reopen the last project on startup.',
  settingsMaxRecent: 'Max Recent Projects',
  settingsMaxRecentDesc: 'Number of recent projects to remember.',
  settingsNotifications: 'Notifications',
  settingsShowProgress: 'Show Progress',
  settingsShowProgressDesc: 'Display indexing progress notifications.',
  settingsImpactWarning: 'Impact Warnings',
  settingsImpactWarningDesc: 'Show warnings for high-impact changes.',

  sidebarWikiPages: 'Wiki Pages',
  sidebarNoWikiPages: 'No wiki pages yet.',
  sidebarGenerateHint: 'Click "Generate Wiki" to create documentation.',
  sidebarCodeEntities: 'Code Entities',
  footerEntities: 'entities',
  footerRelations: 'relations',
  footerPages: 'pages',
  more: 'more',

  statusIndexing: 'Indexing...',
  statusReady: 'Ready',
  statusError: 'Error',
  statusEntities: 'entities',
  statusFiles: 'files',

  close: 'Close',
  cancel: 'Cancel',
  confirm: 'Confirm',
  loading: 'Loading...',
  error: 'Error',
  success: 'Success',
  warning: 'Warning',
  copy: 'Copy',
  copied: 'Copied!',
  open: 'Open',
  delete: 'Delete',
  edit: 'Edit',
  save: 'Save',
  export: 'Export',
  import_: 'Import',
}

const zh: I18nStrings = {
  appName: 'CodeWiki',
  appDescription: '基于本体语义模型的 AI 代码知识库',
  appWindowTitle: 'CodeWiki - AI 代码知识库',

  navWiki: '文档',
  navGraph: '图谱',
  navSearch: '搜索',
  navChat: '对话',
  navAgent: '代理',

  home: '首页',
  settings: '设置',
  reindex: '重新索引',
  topShowSidebar: '显示侧边栏',
  topHideSidebar: '隐藏侧边栏',
  topBackToProjects: '返回项目',
  topReindexTitle: '重新索引项目',
  topGenerateWiki: '生成 Wiki',
  topConfigureApiKey: '请先在设置中配置 API 密钥。',
  loadingGeneratingWiki: '正在生成 Wiki...',
  loadingReindexing: '正在重新索引项目...',

  welcomeTitle: '欢迎使用 CodeWiki',
  welcomeSubtitle: '选择一个项目文件夹开始',
  welcomeDescription: '基于本体语义模型的 AI 代码知识库。生成项目文档、知识图谱，实现精确的代码分析与修改。',
  openFolder: '打开项目文件夹',
  recentProjects: '最近项目',
  noRecentProjects: '暂无最近的项目',
  featOntology: '本体模型',
  featSemantic: '语义检索',
  featGraph: '知识图谱',
  featImpact: '影响分析',
  welcomeOpenLocal: '打开本地文件夹',
  welcomeOpenLocalDesc: '选择本地项目文件夹，自动分析代码结构并生成 Wiki 文档。',
  welcomeGithub: 'GitHub 仓库',
  welcomeGo: '前往',
  welcomeRemoveRecent: '从最近移除',
  loadingIndexing: '正在索引项目...',
  loadingFetching: '正在获取仓库...',
  errInvalidGithubUrl: '请输入有效的 GitHub 链接',
  errIndexFailed: '索引项目失败',
  errFetchFailed: '获取仓库失败',
  errOpenFailed: '打开项目失败',

  wikiTitle: '文档',
  wikiGenerating: '正在生成 Wiki 文档...',
  wikiNoContent: '尚无 Wiki 内容。请先索引一个项目来生成文档。',
  wikiRegenerate: '重新生成',
  wikiNoneTitle: '尚未生成 Wiki',
  wikiNoneDescBefore: '点击顶部栏的 ',
  wikiGenerateBtnLabel: '"生成 Wiki"',
  wikiNoneDescAfter: ' 为你的项目创建 AI 文档。你也可以在设置中配置 LLM 提供商。',
  wikiSourceFiles: '个源文件',
  mermaidRaw: '图表（原始文本）',
  mermaidRenderFailed: '图表渲染失败',
  qualityLabel: '质量',
  qualityCheckTitle: '文档质量校验',
  qualityStructureTitle: '文档结构校验',

  graphTitle: '知识图谱',
  graphFilter: '按类型过滤',
  graphNoData: '暂无本体数据，请先索引一个项目。',
  graphEntities: '实体',
  graphRelations: '关系',
  graphEmpty: '未找到代码实体。请先索引一个项目以查看知识图谱。',
  graphAllEntities: '全部实体',

  searchPlaceholder: '搜索代码、文档、实体...',
  searchResults: '结果',
  searchNoResults: '未找到结果',
  searchEntity: '实体',
  searchCode: '代码',
  searchWiki: '文档',
  searchButton: '搜索',
  searchAll: '全部',
  searchEntities: '实体',
  searchMatch: '匹配',

  chatTitle: '代码问答',
  chatPlaceholder: '关于你的代码提问...',
  chatSend: '发送',
  chatThinking: '思考中...',
  chatHeaderTitle: '询问你的代码',
  chatClear: '清空对话',
  chatEmptyTitle: '询问关于代码库的任何问题',
  chatEmptyDesc: '使用基于本体的语义搜索和 RAG，为你的代码提供准确、有据可依的回答。',
  chatErrorSuffix: '请检查设置中的 API 密钥。',
  chatErrorFallback: '获取回复失败',
  chatSuggestion1: '认证是如何处理的？',
  chatSuggestion2: '解释数据流',
  chatSuggestion3: '使用了哪些设计模式？',
  chatSuggestion4: '展示主入口',

  agentTitle: '代码代理',
  agentPlaceholder: '描述代码修改需求...',
  agentAnalyze: '分析',
  agentApply: '应用',
  agentRollback: '回滚',
  agentRisk: '风险',
  agentImpact: '影响',
  agentBadge: '本体约束',
  agentHeaderDesc: '使用基于本体的影响分析进行精确的代码修改。通过对照代码知识图谱校验所有改动，防止幻觉。',
  agentInKnowledgeGraph: '（知识图谱中）',
  agentAnalyzing: '分析中...',
  agentAnalyzePlan: '分析并规划',
  agentAnalysisTitle: '分析',
  agentImpactedFiles: '受影响的文件',
  agentProposedMods: '建议的修改',
  agentApplyAll: '全部应用',
  agentRemaining: '剩余',
  agentApplied: '已应用',
  agentLinesLabel: '行',
  agentOriginal: '原始',
  agentModified: '修改后',
  agentWarnings: '警告',
  agentEmptyTitle: '本体约束代码代理',
  agentEmptyDesc: '描述你想要的代码改动。代理会分析本体图谱，识别所有受影响的实体，并在不产生幻觉的前提下提出精确的修改方案。',
  agentSuggestion1: '为主表单处理函数添加输入校验',
  agentSuggestion2: '将数据库查询函数重构为仓储模式',
  agentSuggestion3: '为所有 API 端点添加错误处理',
  agentSuggestion4: '将 UserService 重命名为 AccountService 并更新所有引用',
  agentApplyFailed: '应用失败',
  agentAnalysisFailed: '分析失败',
  agentFailedToApply: '应用失败：',

  entityInfo: '信息',
  entitySource: '源码',
  entityRelations: '关系',
  entityImpact: '影响',
  entityType: '类型',
  entityName: '名称',
  entityFile: '文件',
  entityLine: '行号',
  entityLines: '行',
  entitySignature: '签名',
  entityDescription: '描述',
  entityProperties: '属性',
  entityDetails: '详情',
  entityConnections: '连接',
  entityIncoming: '传入',
  entityOutgoing: '传出',
  entityAffected: '受影响的实体',
  entityDepth: '深度',
  entityNoRelations: '未找到关系',
  entityNoRelationsForEntity: '该实体没有找到关系。',
  entityMayBeAffected: '可能受改动影响',
  entityNoImpact: '未检测到下游影响（孤立实体）。',
  entityCopySource: '复制源码',
  entityLoadingSource: '正在加载源码...',
  entityNoSourceBrowser: '浏览器模式下无可用源码。',
  entitySourcePreviewElectron: '源码预览仅在 Electron 桌面应用中可用。',
  entityCopiedClipboard: '已复制到剪贴板！',

  settingsTitle: '设置',
  settingsAi: 'AI',
  settingsIndexing: '索引',
  settingsOntology: '本体',
  settingsSearch: '搜索',
  settingsInterface: '界面',
  settingsBehavior: '行为',
  settingsWiki: '文档',
  settingsReset: '恢复默认值',
  settingsSave: '保存设置',
  settingsCancel: '取消',
  settingsProvider: 'LLM 提供商',
  settingsModel: '模型',
  settingsApiKey: 'API 密钥',
  settingsApiKeyOptional: '可选',
  settingsApiKeyPlaceholder: '请输入你的 {provider} API 密钥...',
  settingsApiBaseUrl: 'API Base URL',
  settingsOptional: '可选',
  settingsTemperature: '温度',
  settingsTemperatureDesc: '控制随机性。越低越聚焦。',
  settingsMaxTokens: '最大 Token',
  settingsMaxTokensDesc: '响应的最大长度。',
  settingsContextWindow: '上下文窗口',
  settingsContextWindowDesc: '发送给 LLM 的每个文件的最大字符数。',
  settingsStreamResponse: '流式响应',
  settingsStreamResponseDesc: '启用流式输出。',
  settingsTheme: '主题',
  settingsThemeDesc: '应用配色主题。',
  settingsLanguage: '语言',
  settingsLanguageDesc: '界面语言。',
  settingsFontSize: '字号',
  settingsFontSizeDesc: '基础字号（像素）。',
  settingsAutoSave: '自动保存',
  settingsThemeDark: '深色',
  settingsThemeLight: '浅色',
  settingsThemeSystem: '跟随系统',
  settingsMaxDepth: '最大目录深度',
  settingsMaxDepthDesc: '遍历文件夹的深度。',
  settingsMaxFileSize: '最大文件大小',
  settingsMaxFileSizeDesc: '跳过大于此值的文件（字节）。',
  settingsAutoReindex: '自动重新索引',
  settingsAutoReindexDesc: '文件变更时自动重建索引。',
  settingsFileExtensions: '文件扩展名',
  settingsIgnoredDirs: '忽略的目录',
  settingsImpactDepth: '影响分析深度',
  settingsImpactDepthDesc: '影响分析的 BFS 遍历深度。',
  settingsWarnEntities: '警告：实体数量',
  settingsWarnEntitiesDesc: '当影响超过此实体数量时发出警告。',
  settingsWarnFiles: '警告：文件数量',
  settingsWarnFilesDesc: '当影响超过此文件数量时发出警告。',
  settingsExtractDecorators: '提取装饰器',
  settingsExtractDecoratorsDesc: '在本体提取中包含装饰器。',
  settingsExtractArrow: '提取箭头函数',
  settingsExtractArrowDesc: '包含箭头函数和 React 组件。',
  settingsWikiStyle: '文档风格模板',
  settingsWikiStyleDesc: '选择 wiki 生成的提示词风格。不同风格会产生不同的文档结构与详略程度。',
  settingsPageCount: '页面数量',
  settingsPageCountDesc: '生成 wiki 的目标页面数。',
  settingsIncludeMermaid: '含 Mermaid 图表',
  settingsIncludeMermaidDesc: '在 wiki 中生成架构/流程图。',
  settingsAutoGenerate: '打开项目时自动生成',
  settingsAutoGenerateDesc: '索引完成后自动生成 wiki。',
  settingsMaxResults: '最大结果数',
  settingsMaxResultsDesc: '搜索结果的最大数量。',
  settingsMinScore: '最低分数',
  settingsMinScoreDesc: '最低相似度阈值（0-1）。',
  settingsSnippetLength: '摘要长度',
  settingsSnippetLengthDesc: '每条结果摘要显示的最大字符数。',
  settingsKnowledgeGraph: '知识图谱',
  settingsForceStrength: '斥力强度',
  settingsForceStrengthDesc: '节点之间的斥力。',
  settingsLinkDistance: '连线距离',
  settingsLinkDistanceDesc: '相连节点之间的距离。',
  settingsMaxNodes: '最大节点数',
  settingsMaxNodesDesc: '渲染的最大节点数。',
  settingsSidebarWidth: '侧边栏宽度',
  settingsSidebarWidthDesc: '侧边栏宽度（像素）。',
  settingsSidebarPosition: '侧边栏位置',
  settingsSidebarPositionDesc: '侧边栏显示在哪一侧。',
  settingsPosLeft: '左侧',
  settingsPosRight: '右侧',
  settingsShowLineNumbers: '显示行号',
  settingsShowLineNumbersDesc: '在代码视图中显示行号。',
  settingsWordWrap: '自动换行',
  settingsWordWrapDesc: '在代码视图中折行显示长行。',
  settingsAutoSaveDesc: '自动保存项目数据。',
  settingsAutoSaveInterval: '自动保存间隔',
  settingsAutoSaveIntervalDesc: '保存间隔（秒）。',
  settingsConfirmApply: '应用前确认',
  settingsConfirmApplyDesc: '在应用代码改动前显示确认。',
  settingsRememberProject: '记住上次项目',
  settingsRememberProjectDesc: '启动时重新打开上次的项目。',
  settingsMaxRecent: '最近项目数量',
  settingsMaxRecentDesc: '记住的最近项目数量。',
  settingsNotifications: '通知',
  settingsShowProgress: '显示进度',
  settingsShowProgressDesc: '显示索引进度通知。',
  settingsImpactWarning: '影响警告',
  settingsImpactWarningDesc: '对高影响的改动显示警告。',

  sidebarWikiPages: 'Wiki 页面',
  sidebarNoWikiPages: '暂无 Wiki 页面。',
  sidebarGenerateHint: '点击"生成 Wiki"以创建文档。',
  sidebarCodeEntities: '代码实体',
  footerEntities: '个实体',
  footerRelations: '个关系',
  footerPages: '个页面',
  more: '更多',

  statusIndexing: '索引中...',
  statusReady: '就绪',
  statusError: '错误',
  statusEntities: '个实体',
  statusFiles: '个文件',

  close: '关闭',
  cancel: '取消',
  confirm: '确认',
  loading: '加载中...',
  error: '错误',
  success: '成功',
  warning: '警告',
  copy: '复制',
  copied: '已复制！',
  open: '打开',
  delete: '删除',
  edit: '编辑',
  save: '保存',
  export: '导出',
  import_: '导入',
}

const translations: Record<Locale, I18nStrings> = { en, zh }

// Localized display names for ontology entity types.
const entityTypeZh: Record<OntologyEntityType, string> = {
  Module: '模块',
  Class: '类',
  Interface: '接口',
  Function: '函数',
  Method: '方法',
  Variable: '变量',
  Type: '类型',
  Enum: '枚举',
  Package: '包',
  File: '文件',
  Component: '组件',
}

const entityTypePluralEn: Record<OntologyEntityType, string> = {
  Module: 'Modules',
  Class: 'Classes',
  Interface: 'Interfaces',
  Function: 'Functions',
  Method: 'Methods',
  Variable: 'Variables',
  Type: 'Types',
  Enum: 'Enums',
  Package: 'Packages',
  File: 'Files',
  Component: 'Components',
}

let currentLocale: Locale = 'zh'

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function getLocale(): Locale {
  return currentLocale
}

export function t(key: keyof I18nStrings): string {
  return translations[currentLocale][key] || translations.en[key] || key
}

export function getAllTranslations(): I18nStrings {
  return translations[currentLocale]
}

/** Localized singular display name for an ontology entity type. */
export function tEntityType(type: OntologyEntityType): string {
  if (currentLocale === 'zh') return entityTypeZh[type] || type
  return type
}

/** Localized plural display name for an ontology entity type (Chinese has no plural). */
export function tEntityTypePlural(type: OntologyEntityType): string {
  if (currentLocale === 'zh') return entityTypeZh[type] || type
  return entityTypePluralEn[type] || `${type}s`
}
