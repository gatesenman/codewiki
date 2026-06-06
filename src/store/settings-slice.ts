import type { StateCreator } from 'zustand'
import type { AppSettings } from '../types'
import { configManager, type CodeWikiConfig } from '../services/config-manager'
import { setLocale, getLocale, type Locale } from '../services/i18n'
import type { AppState } from './types'

const CONFIG_KEY = 'codewiki-config'
const SEARCH_HISTORY_KEY = 'codewiki-search-history'

export interface SettingsSlice {
  settings: AppSettings
  config: CodeWikiConfig
  locale: Locale
  updateSettings: (settings: Partial<AppSettings>) => void
  updateConfig: <K extends keyof CodeWikiConfig>(section: K, value: Partial<CodeWikiConfig[K]>) => void
  resetConfig: (section?: keyof CodeWikiConfig) => void
  setAppLocale: (locale: Locale) => void
  saveProject: () => Promise<void>
  loadSavedProject: () => Promise<boolean>
  saveConfig: () => Promise<void>
  loadConfig: () => Promise<void>
}

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set, get, store) => ({
  settings: {
    llmProvider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    embeddingModel: 'text-embedding-3-small',
    theme: 'dark',
    maxFileSize: 500000,
    maxDepth: 8,
  },
  config: configManager.getConfig(),
  locale: getLocale(),

  updateSettings: (newSettings) => {
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    }))
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

  updateConfig: (section, value) => {
    configManager.set(section, value)
    set({ config: configManager.getConfig() })
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

  setAppLocale: (locale) => {
    setLocale(locale)
    set({ locale })
    try { localStorage.setItem('codewiki-locale', locale) } catch { /* */ }
  },

  saveProject: async () => {
    const state = store.getState()
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
      const history = localStorage.getItem(SEARCH_HISTORY_KEY)
      if (history) set({ searchHistory: JSON.parse(history) })
      const savedLocale = localStorage.getItem('codewiki-locale') as Locale | null
      if (savedLocale && (savedLocale === 'en' || savedLocale === 'zh')) {
        setLocale(savedLocale)
        set({ locale: savedLocale })
      }
    } catch { /* */ }
  },
})
