import { create } from 'zustand'
import type {
  WikiProject, ChatMessage, SearchResult,
  AppSettings, GraphNode, GraphLink, RecentProject,
} from '../types'
import { configManager, type CodeWikiConfig } from '../services/config-manager'
import { setLocale, getLocale, type Locale } from '../services/i18n'

interface AppState {
  // Project
  currentProject: WikiProject | null
  projects: WikiProject[]
  recentProjects: RecentProject[]
  setCurrentProject: (project: WikiProject | null) => void
  updateProject: (project: WikiProject) => void
  addProject: (project: WikiProject) => void
  addRecentProject: (project: WikiProject) => void
  removeRecentProject: (id: string) => void
  loadRecentProjects: () => void

  // Wiki navigation
  activePageId: string | null
  setActivePageId: (id: string | null) => void

  // View mode
  viewMode: 'wiki' | 'graph' | 'search' | 'chat' | 'agent'
  setViewMode: (mode: AppState['viewMode']) => void

  // Sidebar
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  // Chat
  chatMessages: ChatMessage[]
  addChatMessage: (message: ChatMessage) => void
  clearChat: () => void

  // Search
  searchQuery: string
  searchResults: SearchResult[]
  searchHistory: string[]
  setSearchQuery: (query: string) => void
  setSearchResults: (results: SearchResult[]) => void
  addSearchHistory: (query: string) => void

  // Graph
  graphNodes: GraphNode[]
  graphLinks: GraphLink[]
  setGraphData: (nodes: GraphNode[], links: GraphLink[]) => void
  selectedGraphNode: string | null
  setSelectedGraphNode: (id: string | null) => void

  // Entity Detail
  selectedEntityId: string | null
  setSelectedEntityId: (id: string | null) => void

  // Settings (legacy compat)
  settings: AppSettings
  updateSettings: (settings: Partial<AppSettings>) => void

  // Config (new system)
  config: CodeWikiConfig
  updateConfig: <K extends keyof CodeWikiConfig>(section: K, value: Partial<CodeWikiConfig[K]>) => void
  resetConfig: (section?: keyof CodeWikiConfig) => void

  // i18n
  locale: Locale
  setAppLocale: (locale: Locale) => void

  // Status
  isLoading: boolean
  loadingMessage: string
  setLoading: (loading: boolean, message?: string) => void

  // Persistence
  saveProject: () => Promise<void>
  loadSavedProject: () => Promise<boolean>
  saveConfig: () => Promise<void>
  loadConfig: () => Promise<void>
}

const RECENT_PROJECTS_KEY = 'codewiki-recent-projects'
const CONFIG_KEY = 'codewiki-config'
const SEARCH_HISTORY_KEY = 'codewiki-search-history'

export const useAppStore = create<AppState>((set, get) => ({
  // Project
  currentProject: null,
  projects: [],
  recentProjects: [],
  setCurrentProject: (project) => set({ currentProject: project }),
  updateProject: (project) => set((state) => ({
    currentProject: state.currentProject?.id === project.id ? project : state.currentProject,
    projects: state.projects.map((p) => p.id === project.id ? project : p),
  })),
  addProject: (project) => {
    set((state) => ({
      projects: [...state.projects, project],
      currentProject: project,
    }))
    get().addRecentProject(project)
  },
  addRecentProject: (project) => {
    set((state) => {
      const existing = state.recentProjects.filter(p => p.path !== project.path)
      const entry: RecentProject = {
        id: project.id,
        name: project.name,
        path: project.path,
        type: project.type,
        lastOpened: Date.now(),
        entityCount: project.ontologyGraph?.entities.length,
        fileCount: project.ontologyGraph?.entities.filter(e => e.type === 'File').length,
      }
      const max = configManager.get('behavior').maxRecentProjects
      const updated = [entry, ...existing].slice(0, max)
      try {
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
      } catch { /* no localStorage in some Electron contexts */ }
      return { recentProjects: updated }
    })
  },
  removeRecentProject: (id) => {
    set((state) => {
      const updated = state.recentProjects.filter(p => p.id !== id)
      try {
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
      } catch { /* */ }
      return { recentProjects: updated }
    })
  },
  loadRecentProjects: () => {
    try {
      const stored = localStorage.getItem(RECENT_PROJECTS_KEY)
      if (stored) {
        set({ recentProjects: JSON.parse(stored) })
      }
    } catch { /* */ }
  },

  // Wiki navigation
  activePageId: null,
  setActivePageId: (id) => set({ activePageId: id }),

  // View mode
  viewMode: 'wiki',
  setViewMode: (mode) => set({ viewMode: mode }),

  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  // Chat
  chatMessages: [],
  addChatMessage: (message) => set((state) => ({ chatMessages: [...state.chatMessages, message] })),
  clearChat: () => set({ chatMessages: [] }),

  // Search
  searchQuery: '',
  searchResults: [],
  searchHistory: [],
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchResults: (results) => set({ searchResults: results }),
  addSearchHistory: (query) => {
    set((state) => {
      const existing = state.searchHistory.filter(q => q !== query)
      const updated = [query, ...existing].slice(0, 20)
      try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated))
      } catch { /* */ }
      return { searchHistory: updated }
    })
  },

  // Graph
  graphNodes: [],
  graphLinks: [],
  setGraphData: (nodes, links) => set({ graphNodes: nodes, graphLinks: links }),
  selectedGraphNode: null,
  setSelectedGraphNode: (id) => set({ selectedGraphNode: id }),

  // Entity Detail
  selectedEntityId: null,
  setSelectedEntityId: (id) => set({ selectedEntityId: id }),

  // Settings (legacy compat — delegates to config manager)
  settings: {
    llmProvider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    embeddingModel: 'text-embedding-3-small',
    theme: 'dark',
    maxFileSize: 500000,
    maxDepth: 8,
  },
  updateSettings: (newSettings) => {
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    }))
    // Sync to new config
    const s = get().settings
    configManager.set('llm', {
      provider: s.llmProvider,
      apiKey: s.apiKey,
      apiBaseUrl: s.apiBaseUrl || '',
      model: s.model,
      embeddingModel: s.embeddingModel,
    })
    if (s.theme) configManager.set('ui', { theme: s.theme })
  },

  // Config (new system)
  config: configManager.getConfig(),
  updateConfig: (section, value) => {
    configManager.set(section, value)
    set({ config: configManager.getConfig() })
    // Sync legacy settings
    const legacy = configManager.toLegacySettings()
    set({ settings: legacy as AppSettings })
    get().saveConfig()
  },
  resetConfig: (section) => {
    configManager.reset(section)
    set({ config: configManager.getConfig() })
    const legacy = configManager.toLegacySettings()
    set({ settings: legacy as AppSettings })
    get().saveConfig()
  },

  // i18n
  locale: getLocale(),
  setAppLocale: (locale) => {
    setLocale(locale)
    set({ locale })
    try { localStorage.setItem('codewiki-locale', locale) } catch { /* */ }
  },

  // Status
  isLoading: false,
  loadingMessage: '',
  setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),

  // Persistence
  saveProject: async () => {
    const state = useAppStore.getState()
    if (!state.currentProject || !window.electronAPI?.saveWikiData) return
    try {
      const data = JSON.stringify({
        project: state.currentProject,
        settings: state.settings,
        config: configManager.toJSON(),
      })
      await window.electronAPI.saveWikiData(state.currentProject.id, data)
    } catch (err) {
      console.error('Failed to save project:', err)
    }
  },
  loadSavedProject: async () => {
    if (!window.electronAPI?.getAppDataPath) return false
    try {
      await window.electronAPI.getAppDataPath()
      return false
    } catch {
      return false
    }
  },
  saveConfig: async () => {
    try {
      localStorage.setItem(CONFIG_KEY, configManager.toJSON())
    } catch { /* */ }
  },
  loadConfig: async () => {
    try {
      const stored = localStorage.getItem(CONFIG_KEY)
      if (stored) {
        configManager.loadFromJSON(stored)
        set({ config: configManager.getConfig() })
        const legacy = configManager.toLegacySettings()
        set({ settings: legacy as AppSettings })
      }
      // Load search history
      const history = localStorage.getItem(SEARCH_HISTORY_KEY)
      if (history) set({ searchHistory: JSON.parse(history) })
      // Load locale
      const savedLocale = localStorage.getItem('codewiki-locale') as Locale | null
      if (savedLocale && (savedLocale === 'en' || savedLocale === 'zh')) {
        setLocale(savedLocale)
        set({ locale: savedLocale })
      }
    } catch { /* */ }
  },
}))


