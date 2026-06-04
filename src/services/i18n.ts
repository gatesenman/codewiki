/**
 * Internationalization (i18n) system for CodeWiki
 * Supports Chinese (zh) and English (en)
 */

export type Locale = 'en' | 'zh'

export interface I18nStrings {
  // App
  appName: string
  appDescription: string

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

  // Welcome Screen
  welcomeTitle: string
  welcomeSubtitle: string
  openFolder: string
  recentProjects: string
  noRecentProjects: string

  // Wiki Viewer
  wikiTitle: string
  wikiGenerating: string
  wikiNoContent: string
  wikiRegenerate: string

  // Knowledge Graph
  graphTitle: string
  graphFilter: string
  graphNoData: string
  graphEntities: string
  graphRelations: string

  // Search
  searchPlaceholder: string
  searchResults: string
  searchNoResults: string
  searchEntity: string
  searchCode: string
  searchWiki: string

  // Chat
  chatTitle: string
  chatPlaceholder: string
  chatSend: string
  chatThinking: string

  // Code Agent
  agentTitle: string
  agentPlaceholder: string
  agentAnalyze: string
  agentApply: string
  agentRollback: string
  agentRisk: string
  agentImpact: string

  // Entity Detail Panel
  entityInfo: string
  entitySource: string
  entityRelations: string
  entityImpact: string
  entityType: string
  entityFile: string
  entityLine: string
  entitySignature: string
  entityProperties: string
  entityIncoming: string
  entityOutgoing: string
  entityAffected: string
  entityDepth: string
  entityNoRelations: string

  // Settings
  settingsTitle: string
  settingsAi: string
  settingsIndexing: string
  settingsOntology: string
  settingsSearch: string
  settingsInterface: string
  settingsBehavior: string
  settingsReset: string
  settingsSave: string
  settingsProvider: string
  settingsModel: string
  settingsApiKey: string
  settingsTemperature: string
  settingsMaxTokens: string
  settingsTheme: string
  settingsLanguage: string
  settingsFontSize: string
  settingsAutoSave: string

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

  navWiki: 'Wiki',
  navGraph: 'Graph',
  navSearch: 'Search',
  navChat: 'Chat',
  navAgent: 'Agent',

  home: 'Home',
  settings: 'Settings',
  reindex: 'Re-index',

  welcomeTitle: 'Welcome to CodeWiki',
  welcomeSubtitle: 'Select a project folder to get started',
  openFolder: 'Open Project Folder',
  recentProjects: 'Recent Projects',
  noRecentProjects: 'No recent projects',

  wikiTitle: 'Wiki',
  wikiGenerating: 'Generating wiki documentation...',
  wikiNoContent: 'No wiki content yet. Index a project to generate documentation.',
  wikiRegenerate: 'Regenerate',

  graphTitle: 'Knowledge Graph',
  graphFilter: 'Filter by type',
  graphNoData: 'No ontology data. Index a project first.',
  graphEntities: 'Entities',
  graphRelations: 'Relations',

  searchPlaceholder: 'Search code, entities, wiki...',
  searchResults: 'Results',
  searchNoResults: 'No results found',
  searchEntity: 'Entity',
  searchCode: 'Code',
  searchWiki: 'Wiki',

  chatTitle: 'Ask about Code',
  chatPlaceholder: 'Ask a question about your codebase...',
  chatSend: 'Send',
  chatThinking: 'Thinking...',

  agentTitle: 'Code Agent',
  agentPlaceholder: 'Describe the code modification...',
  agentAnalyze: 'Analyze',
  agentApply: 'Apply',
  agentRollback: 'Rollback',
  agentRisk: 'Risk',
  agentImpact: 'Impact',

  entityInfo: 'Info',
  entitySource: 'Source',
  entityRelations: 'Relations',
  entityImpact: 'Impact',
  entityType: 'Type',
  entityFile: 'File',
  entityLine: 'Line',
  entitySignature: 'Signature',
  entityProperties: 'Properties',
  entityIncoming: 'Incoming',
  entityOutgoing: 'Outgoing',
  entityAffected: 'Affected Entities',
  entityDepth: 'Depth',
  entityNoRelations: 'No relations found',

  settingsTitle: 'Settings',
  settingsAi: 'AI',
  settingsIndexing: 'Indexing',
  settingsOntology: 'Ontology',
  settingsSearch: 'Search',
  settingsInterface: 'Interface',
  settingsBehavior: 'Behavior',
  settingsReset: 'Reset to Defaults',
  settingsSave: 'Save',
  settingsProvider: 'Provider',
  settingsModel: 'Model',
  settingsApiKey: 'API Key',
  settingsTemperature: 'Temperature',
  settingsMaxTokens: 'Max Tokens',
  settingsTheme: 'Theme',
  settingsLanguage: 'Language',
  settingsFontSize: 'Font Size',
  settingsAutoSave: 'Auto Save',

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

  navWiki: '文档',
  navGraph: '图谱',
  navSearch: '搜索',
  navChat: '对话',
  navAgent: '代理',

  home: '首页',
  settings: '设置',
  reindex: '重新索引',

  welcomeTitle: '欢迎使用 CodeWiki',
  welcomeSubtitle: '选择一个项目文件夹开始',
  openFolder: '打开项目文件夹',
  recentProjects: '最近的项目',
  noRecentProjects: '暂无最近的项目',

  wikiTitle: '文档',
  wikiGenerating: '正在生成 Wiki 文档...',
  wikiNoContent: '尚无 Wiki 内容。请先索引一个项目来生成文档。',
  wikiRegenerate: '重新生成',

  graphTitle: '知识图谱',
  graphFilter: '按类型过滤',
  graphNoData: '暂无本体数据，请先索引一个项目。',
  graphEntities: '实体',
  graphRelations: '关系',

  searchPlaceholder: '搜索代码、实体、文档...',
  searchResults: '结果',
  searchNoResults: '未找到结果',
  searchEntity: '实体',
  searchCode: '代码',
  searchWiki: '文档',

  chatTitle: '代码问答',
  chatPlaceholder: '关于代码库提问...',
  chatSend: '发送',
  chatThinking: '思考中...',

  agentTitle: '代码代理',
  agentPlaceholder: '描述代码修改需求...',
  agentAnalyze: '分析',
  agentApply: '应用',
  agentRollback: '回滚',
  agentRisk: '风险',
  agentImpact: '影响',

  entityInfo: '信息',
  entitySource: '源码',
  entityRelations: '关系',
  entityImpact: '影响',
  entityType: '类型',
  entityFile: '文件',
  entityLine: '行号',
  entitySignature: '签名',
  entityProperties: '属性',
  entityIncoming: '传入',
  entityOutgoing: '传出',
  entityAffected: '受影响的实体',
  entityDepth: '深度',
  entityNoRelations: '未找到关系',

  settingsTitle: '设置',
  settingsAi: 'AI',
  settingsIndexing: '索引',
  settingsOntology: '本体',
  settingsSearch: '搜索',
  settingsInterface: '界面',
  settingsBehavior: '行为',
  settingsReset: '恢复默认值',
  settingsSave: '保存',
  settingsProvider: '提供商',
  settingsModel: '模型',
  settingsApiKey: 'API 密钥',
  settingsTemperature: '温度',
  settingsMaxTokens: '最大 Token',
  settingsTheme: '主题',
  settingsLanguage: '语言',
  settingsFontSize: '字号',
  settingsAutoSave: '自动保存',

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
