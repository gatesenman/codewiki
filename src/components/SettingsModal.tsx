import { useState } from 'react'
import {
  X, Server, Cpu, Palette, FolderCog,
  Eye, Search, GitBranch, BookOpen, TerminalSquare,
  Shield, Plug,
} from 'lucide-react'
import { useAppStore } from '../store'
import type { CodeWikiConfig } from '../services/config-manager'
import { t } from '../services/i18n'
import type { Locale, I18nStrings } from '../services/i18n'
import {
  AISettings, IndexingSettings, OntologySettings,
  WikiSettings, SearchSettings, UISettings,
  BehaviorSettings, VerifySettings, PrivacySettings, McpSettings,
} from './settings/SettingsTabs'

interface Props {
  onClose: () => void
}

type SettingsTab = 'ai' | 'indexing' | 'ui' | 'behavior' | 'ontology' | 'search' | 'wiki' | 'privacy' | 'verify' | 'mcp'

const TABS: { id: SettingsTab; labelKey: keyof I18nStrings; icon: typeof Server }[] = [
  { id: 'ai', labelKey: 'settingsAi', icon: Cpu },
  { id: 'indexing', labelKey: 'settingsIndexing', icon: FolderCog },
  { id: 'ontology', labelKey: 'settingsOntology', icon: GitBranch },
  { id: 'search', labelKey: 'settingsSearch', icon: Search },
  { id: 'wiki', labelKey: 'settingsWiki', icon: BookOpen },
  { id: 'ui', labelKey: 'settingsInterface', icon: Palette },
  { id: 'behavior', labelKey: 'settingsBehavior', icon: Eye },
  { id: 'privacy', labelKey: 'settingsPrivacy', icon: Shield },
  { id: 'verify', labelKey: 'settingsVerify', icon: TerminalSquare },
  { id: 'mcp', labelKey: 'settingsMcp', icon: Plug },
]

export function SettingsModal({ onClose }: Props) {
  const config = useAppStore(s => s.config)
  const updateConfig = useAppStore(s => s.updateConfig)
  const resetConfig = useAppStore(s => s.resetConfig)
  const setAppLocale = useAppStore(s => s.setAppLocale)
  useAppStore(s => s.locale)
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai')
  const [localConfig, setLocalConfig] = useState<CodeWikiConfig>(JSON.parse(JSON.stringify(config)))

  const handleSave = () => {
    for (const key of Object.keys(localConfig) as (keyof CodeWikiConfig)[]) {
      updateConfig(key, localConfig[key])
    }
    const lang = localConfig.ui.language
    if (lang === 'en' || lang === 'zh-CN' || lang === 'zh') {
      setAppLocale((lang === 'zh-CN' ? 'zh' : lang) as Locale)
    }
    onClose()
  }

  const handleReset = () => {
    resetConfig(activeTab === 'ai' ? 'llm' : activeTab as keyof CodeWikiConfig)
    setLocalConfig(JSON.parse(JSON.stringify(useAppStore.getState().config)))
  }

  const updateLocal = <K extends keyof CodeWikiConfig>(section: K, value: Partial<CodeWikiConfig[K]>) => {
    setLocalConfig(prev => ({
      ...prev,
      [section]: { ...prev[section], ...value },
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[720px] max-h-[85vh] bg-wiki-sidebar border border-wiki-border rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-wiki-border shrink-0">
          <h2 className="text-lg font-semibold">{t('settingsTitle')}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-wiki-card text-wiki-muted hover:text-wiki-text">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tab sidebar */}
          <div className="w-44 border-r border-wiki-border bg-wiki-bg/50 py-2 overflow-y-auto shrink-0">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-wiki-accent/10 text-wiki-accent border-r-2 border-wiki-accent font-medium'
                    : 'text-wiki-muted hover:text-wiki-text hover:bg-wiki-card/50'
                }`}
              >
                <tab.icon size={14} />
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {activeTab === 'ai' && <AISettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'indexing' && <IndexingSettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'ontology' && <OntologySettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'search' && <SearchSettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'wiki' && <WikiSettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'ui' && <UISettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'behavior' && <BehaviorSettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'privacy' && <PrivacySettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'verify' && <VerifySettings config={localConfig} updateLocal={updateLocal} />}
            {activeTab === 'mcp' && <McpSettings config={localConfig} updateLocal={updateLocal} />}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-wiki-border shrink-0">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-wiki-muted hover:text-wiki-text transition-colors"
          >
            {t('settingsReset')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-wiki-border text-sm text-wiki-muted hover:text-wiki-text transition-colors"
            >
              {t('settingsCancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-wiki-accent text-white text-sm font-medium hover:bg-wiki-accent/80 transition-colors"
            >
              {t('settingsSave')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
