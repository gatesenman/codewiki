/**
 * Configuration Manager
 *
 * Centralized configuration system for CodeWiki.
 * Loads from: project-level → global-level → built-in defaults.
 * Emits events on changes so components can react.
 */

export interface IndexingConfig {
  maxDepth: number
  maxFileSize: number
  extensions: string[]
  ignoreDirs: string[]
  ignorePatterns: string[]
  autoReindex: boolean
  watchMode: boolean
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'deepseek' | 'ollama'
  model: string
  apiKey: string
  apiBaseUrl: string
  embeddingModel: string
  temperature: number
  maxTokens: number
  contextWindow: number
  streamResponse: boolean
}

export interface OntologyConfig {
  impactDepth: number
  warningThreshold: {
    entities: number
    files: number
  }
  extractDecorators: boolean
  extractArrowFunctions: boolean
}

export interface SearchConfig {
  maxResults: number
  minScore: number
  snippetLength: number
}

export interface WikiConfig {
  pageCount: number
  autoGenerate: boolean
  includeMermaid: boolean
  promptStyle: 'hierarchical' | 'engineering' | 'concise'
}

export interface GraphConfig {
  forceStrength: number
  linkDistance: number
  collisionRadius: number
  maxNodes: number
}

export interface UIConfig {
  theme: 'dark' | 'light' | 'system'
  language: 'en' | 'zh-CN'
  fontSize: number
  sidebarWidth: number
  sidebarPosition: 'left' | 'right'
  showLineNumbers: boolean
  wordWrap: boolean
  codeTheme: 'github-dark' | 'github-light' | 'monokai' | 'one-dark'
}

export interface BehaviorConfig {
  autoSave: boolean
  autoSaveInterval: number
  confirmBeforeApply: boolean
  showWelcome: boolean
  rememberLastProject: boolean
  maxRecentProjects: number
}

export interface NotificationConfig {
  showProgress: boolean
  showImpactWarning: boolean
  soundEnabled: boolean
}

export interface CodeWikiConfig {
  indexing: IndexingConfig
  llm: LLMConfig
  ontology: OntologyConfig
  search: SearchConfig
  wiki: WikiConfig
  graph: GraphConfig
  ui: UIConfig
  behavior: BehaviorConfig
  notifications: NotificationConfig
}

export const DEFAULT_CONFIG: CodeWikiConfig = {
  indexing: {
    maxDepth: 8,
    maxFileSize: 500000,
    extensions: [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp',
      '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue',
      '.svelte', '.md', '.json', '.yaml', '.yml', '.toml',
    ],
    ignoreDirs: [
      'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
      '.next', '.nuxt', '__pycache__', '.pytest_cache', '.mypy_cache',
      'target', 'bin', 'obj', '.idea', '.vscode', '.vs', 'coverage',
      '.turbo', '.cache', 'tmp', 'temp',
    ],
    ignorePatterns: [],
    autoReindex: false,
    watchMode: false,
  },
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: '',
    apiBaseUrl: '',
    embeddingModel: 'text-embedding-3-small',
    temperature: 0.3,
    maxTokens: 16384,
    contextWindow: 8000,
    streamResponse: true,
  },
  ontology: {
    impactDepth: 3,
    warningThreshold: { entities: 20, files: 8 },
    extractDecorators: true,
    extractArrowFunctions: true,
  },
  search: {
    maxResults: 10,
    minScore: 0.01,
    snippetLength: 500,
  },
  wiki: {
    pageCount: 6,
    autoGenerate: false,
    includeMermaid: true,
    promptStyle: 'hierarchical',
  },
  graph: {
    forceStrength: -200,
    linkDistance: 80,
    collisionRadius: 20,
    maxNodes: 500,
  },
  ui: {
    theme: 'dark',
    language: 'zh-CN',
    fontSize: 14,
    sidebarWidth: 256,
    sidebarPosition: 'left',
    showLineNumbers: true,
    wordWrap: true,
    codeTheme: 'github-dark',
  },
  behavior: {
    autoSave: true,
    autoSaveInterval: 30000,
    confirmBeforeApply: true,
    showWelcome: true,
    rememberLastProject: true,
    maxRecentProjects: 10,
  },
  notifications: {
    showProgress: true,
    showImpactWarning: true,
    soundEnabled: false,
  },
}

type ConfigListener = (config: CodeWikiConfig) => void

export class ConfigManager {
  private config: CodeWikiConfig
  private listeners: Set<ConfigListener> = new Set()

  constructor(initial?: Partial<CodeWikiConfig>) {
    this.config = this.mergeDeep(DEFAULT_CONFIG as unknown as Record<string, unknown>, (initial || {}) as unknown as Record<string, unknown>) as unknown as CodeWikiConfig
  }

  getConfig(): CodeWikiConfig {
    return this.config
  }

  get<K extends keyof CodeWikiConfig>(section: K): CodeWikiConfig[K] {
    return this.config[section]
  }

  set<K extends keyof CodeWikiConfig>(section: K, value: Partial<CodeWikiConfig[K]>): void {
    this.config = {
      ...this.config,
      [section]: { ...this.config[section], ...value },
    }
    this.notify()
  }

  update(partial: Partial<CodeWikiConfig>): void {
    this.config = this.mergeDeep(this.config as unknown as Record<string, unknown>, partial as unknown as Record<string, unknown>) as unknown as CodeWikiConfig
    this.notify()
  }

  reset(section?: keyof CodeWikiConfig): void {
    if (section) {
      this.config = { ...this.config, [section]: { ...DEFAULT_CONFIG[section] } }
    } else {
      this.config = { ...DEFAULT_CONFIG }
    }
    this.notify()
  }

  subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  toJSON(): string {
    return JSON.stringify(this.config, null, 2)
  }

  loadFromJSON(json: string): void {
    try {
      const parsed = JSON.parse(json)
      this.config = this.mergeDeep(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed as Record<string, unknown>) as unknown as CodeWikiConfig
      this.notify()
    } catch {
      console.error('Failed to parse config JSON')
    }
  }

  /** Convert to legacy AppSettings format for backward compatibility */
  toLegacySettings() {
    return {
      llmProvider: this.config.llm.provider,
      apiKey: this.config.llm.apiKey,
      apiBaseUrl: this.config.llm.apiBaseUrl || undefined,
      model: this.config.llm.model,
      embeddingModel: this.config.llm.embeddingModel,
      theme: this.config.ui.theme === 'system' ? 'dark' : this.config.ui.theme,
      maxFileSize: this.config.indexing.maxFileSize,
      maxDepth: this.config.indexing.maxDepth,
    }
  }

  /** Load from legacy AppSettings */
  loadFromLegacy(legacy: {
    llmProvider?: string
    apiKey?: string
    apiBaseUrl?: string
    model?: string
    embeddingModel?: string
    theme?: string
    maxFileSize?: number
    maxDepth?: number
  }): void {
    if (legacy.llmProvider) this.config.llm.provider = legacy.llmProvider as LLMConfig['provider']
    if (legacy.apiKey) this.config.llm.apiKey = legacy.apiKey
    if (legacy.apiBaseUrl) this.config.llm.apiBaseUrl = legacy.apiBaseUrl
    if (legacy.model) this.config.llm.model = legacy.model
    if (legacy.embeddingModel) this.config.llm.embeddingModel = legacy.embeddingModel
    if (legacy.theme) this.config.ui.theme = legacy.theme as UIConfig['theme']
    if (legacy.maxFileSize) this.config.indexing.maxFileSize = legacy.maxFileSize
    if (legacy.maxDepth) this.config.indexing.maxDepth = legacy.maxDepth
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.config)
    }
  }

  private mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target }
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = this.mergeDeep(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        )
      } else {
        result[key] = source[key]
      }
    }
    return result
  }
}

export const configManager = new ConfigManager()
