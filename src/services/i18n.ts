/**
 * Internationalization (i18n) system for CodeWiki
 * Supports Chinese (zh) and English (en)
 */

import type { OntologyEntityType } from '../types'
import enJson from '../locales/en.json'
import zhJson from '../locales/zh.json'

export type Locale = 'en' | 'zh'

export interface I18nStrings {
  agentConfirmApply: string
  settingsWatchMode: string
  settingsWatchModeDesc: string
  settingsIgnorePatterns: string
  settingsIgnorePatternsDesc: string
  settingsWarnThresholdHint: string
  settingsMcpGenerated: string
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
  navInsights: string
  navCodeMap: string

  // Code Map
  codeMapEmpty: string
  codeMapEmptyHint: string
  codeMapTreemap: string
  codeMapModuleGraph: string
  codeMapExplorer: string
  codeMapFiles: string
  codeMapEntities: string
  codeMapRelations: string
  codeMapFileTree: string
  codeMapSelectFile: string
  codeMapInbound: string
  codeMapOutbound: string
  codeMapLines: string
  codeMapEntitiesInFile: string
  codeMapArchitecture: string
  codeMapArchDiagrams: string
  codeMapArchDesc: string
  wikiExport: string

  // Insights panel
  insTitle: string
  insSubtitle: string
  insNoProject: string
  insTabHealth: string
  insTabSecurity: string
  insTabQuery: string
  insTabHistory: string
  insTabWiki: string
  insTabEval: string
  // Health tool
  insHealthHint: string
  insHealthRefresh: string
  insHealthEntities: string
  insHealthFiles: string
  insHealthAvgDegree: string
  insHealthCircular: string
  insHealthDead: string
  insHealthGod: string
  insHealthBreakdown: string
  insHealthCircularTitle: string
  insHealthNoCircular: string
  insHealthFilesWord: string
  insHealthEdgesWord: string
  insHealthHotspots: string
  insHealthNoHotspots: string
  insHealthC_circularDeps: string
  insHealthC_deadCode: string
  insHealthC_coupling: string
  insHealthC_godObjects: string
  insHealthC_security: string
  // Security tool
  insSecHint: string
  insSecScan: string
  insSecScanning: string
  insSecClean: string
  insSecNoFs: string
  insSev_high: string
  insSev_medium: string
  insSev_low: string
  insQueryPlaceholder: string
  insQueryRun: string
  insQueryHint: string
  insQueryNoResult: string
  insQueryEntities: string
  insQueryRelations: string
  insHistSnapshot: string
  insHistClear: string
  insHistNoSnapshots: string
  insHistHint: string
  insHistTrend: string
  insHistEntities: string
  insHistRelations: string
  insHistCouplingUp: string
  insHistCouplingStable: string
  insHistTimeline: string
  insHistDiff: string
  insHistAdded: string
  insHistRemoved: string
  insHistMoved: string
  insWikiPlaceholder: string
  insWikiRun: string
  insWikiHint: string
  insWikiNone: string
  insWikiFull: string
  insWikiAffected: string
  insWikiDirect: string
  insWikiTransitive: string
  insEvalPlaceholder: string
  insEvalBaselinePlaceholder: string
  insEvalRun: string
  insEvalHint: string
  insEvalError: string
  insEvalOverall: string
  insEvalPrecision: string
  insEvalRecall: string
  insEvalF1: string
  insEvalCases: string
  insEvalRegressions: string
  insEvalNoRegressions: string

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
  graph3dFallback: string
  graphColorMode: string
  graphColorType: string
  graphColorCoupling: string
  graphColorRisk: string
  graphColorLow: string
  graphColorMed: string
  graphColorHigh: string
  graphColorAnti: string
  graphColorPattern: string
  graphColorPlain: string

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
  agentAutoFix: string
  agentWorking: string
  agentAutoFixTitleVerify: string
  agentAutoFixTitlePlain: string
  agentVerify: string
  agentVerifyRun: string
  agentRollbackTitle: string
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
  entityPatterns: string
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
  // Settings: tabs added in v1.0.2
  settingsPrivacy: string
  settingsMcp: string
  settingsVerify: string
  // Settings: privacy
  settingsUseIgnoreFile: string
  settingsUseIgnoreFileDesc: string
  settingsExcludeSensitive: string
  settingsExcludeSensitiveDesc: string
  settingsRedactSecrets: string
  settingsRedactSecretsDesc: string
  settingsExtraPatterns: string
  settingsExtraPatternsDesc: string
  settingsExtraPatternsPlaceholder: string
  // Settings: graph rendering (3D)
  settingsRender3D: string
  settingsRender3DDesc: string
  settingsNodeSize: string
  settingsNodeSizeDesc: string
  settingsShowLabels: string
  settingsShowLabelsDesc: string
  settingsRotationSpeed: string
  settingsRotationSpeedDesc: string
  // Settings: embeddings
  settingsHybridSearch: string
  settingsHybridSearchDesc: string
  settingsEmbedProvider: string
  settingsEmbedProviderDesc: string
  settingsEmbedModel: string
  settingsEmbedModelDesc: string
  settingsEmbedBaseUrl: string
  settingsEmbedBaseUrlDesc: string
  settingsRrfK: string
  settingsRrfKDesc: string
  // Settings: verification
  settingsVerifyEnable: string
  settingsVerifyEnableDesc: string
  settingsLintCommand: string
  settingsBuildCommand: string
  settingsTestCommand: string
  settingsTimeout: string
  settingsTimeoutDesc: string
  // Settings: MCP server
  settingsMcpEnable: string
  settingsMcpEnableDesc: string
  settingsMcpTransport: string
  settingsMcpTransportDesc: string
  settingsMcpPort: string
  settingsMcpPortDesc: string
  settingsMcpProjectPath: string
  settingsMcpProjectPathDesc: string
  settingsMcpLogDir: string
  settingsMcpLogDirDesc: string
  settingsMcpConsumer: string
  settingsMcpConsumerDesc: string
  settingsMcpTools: string
  settingsMcpToolsDesc: string
  settingsMcpToolsPlaceholder: string
  settingsMcpDocsHint: string

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


const en = enJson as unknown as I18nStrings
const zh = zhJson as unknown as I18nStrings

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
