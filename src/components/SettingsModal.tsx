import { useState } from 'react'
import {
  X, Key, Server, Cpu, Palette, Monitor, FolderCog,
  Eye, Bell, RotateCcw, Search, GitBranch, FileCode, BookOpen, TerminalSquare,
  Shield, Plug,
} from 'lucide-react'
import { listWikiTemplates } from '../services/wiki-prompt-templates'
import { useAppStore } from '../store'
import type { CodeWikiConfig } from '../services/config-manager'
import { t } from '../services/i18n'
import type { Locale, I18nStrings } from '../services/i18n'

interface Props {
  onClose: () => void
}

type SettingsTab = 'ai' | 'indexing' | 'ui' | 'behavior' | 'ontology' | 'search' | 'wiki' | 'privacy' | 'verify' | 'mcp'

const PROVIDERS = [
  { id: 'openai' as const, name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'] },
  { id: 'anthropic' as const, name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] },
  { id: 'deepseek' as const, name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'ollama' as const, name: 'Ollama (Local)', models: ['llama3.1', 'codellama', 'mistral', 'qwen2.5-coder'] },
]

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
  const { config, updateConfig, resetConfig, setAppLocale } = useAppStore()
  useAppStore(s => s.locale)
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai')
  const [localConfig, setLocalConfig] = useState<CodeWikiConfig>(JSON.parse(JSON.stringify(config)))

  const handleSave = () => {
    // Apply each section
    for (const key of Object.keys(localConfig) as (keyof CodeWikiConfig)[]) {
      updateConfig(key, localConfig[key])
    }
    // Apply locale
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

        <div className="flex flex-1 overflow-hidden">
          {/* Tab list */}
          <div className="w-44 border-r border-wiki-border py-2 shrink-0">
            {TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'text-wiki-accent bg-wiki-accent/10 border-r-2 border-wiki-accent'
                      : 'text-wiki-muted hover:text-wiki-text hover:bg-wiki-card/50'
                  }`}
                >
                  <Icon size={14} />
                  {t(tab.labelKey)}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-wiki-muted hover:text-wiki-text transition-colors"
          >
            <RotateCcw size={14} />
            {t('settingsReset')}
          </button>
          <div className="flex gap-3">
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

// --- Tab Components ---

interface TabProps {
  config: CodeWikiConfig
  updateLocal: <K extends keyof CodeWikiConfig>(section: K, value: Partial<CodeWikiConfig[K]>) => void
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-wiki-text">{label}</div>
        {description && <div className="text-xs text-wiki-muted mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-wiki-accent' : 'bg-wiki-card border border-wiki-border'
      }`}
    >
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`} />
    </button>
  )
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="w-24 px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-sm text-wiki-text text-right focus:outline-none focus:border-wiki-accent"
    />
  )
}

function SelectInput<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      className="px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-sm text-wiki-text focus:outline-none focus:border-wiki-accent"
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function AISettings({ config, updateLocal }: TabProps) {
  const currentProvider = PROVIDERS.find(p => p.id === config.llm.provider) || PROVIDERS[0]

  return (
    <>
      {/* Provider */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-wiki-text mb-2">
          <Server size={14} />
          {t('settingsProvider')}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(provider => (
            <button
              key={provider.id}
              onClick={() => updateLocal('llm', { provider: provider.id, model: provider.models[0] })}
              className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                config.llm.provider === provider.id
                  ? 'border-wiki-accent bg-wiki-accent/10 text-wiki-accent'
                  : 'border-wiki-border bg-wiki-card text-wiki-muted hover:border-wiki-accent/30'
              }`}
            >
              {provider.name}
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-wiki-text mb-2">
          <Key size={14} />
          {t('settingsApiKey')} {config.llm.provider === 'ollama' && <span className="text-wiki-muted">({t('settingsApiKeyOptional')})</span>}
        </label>
        <input
          type="password"
          value={config.llm.apiKey}
          onChange={e => updateLocal('llm', { apiKey: e.target.value })}
          placeholder={t('settingsApiKeyPlaceholder').replace('{provider}', currentProvider.name)}
          className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
        />
      </div>

      {/* Model */}
      <SettingRow label={t('settingsModel')}>
        <select
          value={config.llm.model}
          onChange={e => updateLocal('llm', { model: e.target.value })}
          className="w-48 px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-sm text-wiki-text focus:outline-none focus:border-wiki-accent"
        >
          {currentProvider.models.map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
      </SettingRow>

      {/* API Base URL */}
      <div>
        <label className="text-sm font-medium text-wiki-text mb-2 block">
          {t('settingsApiBaseUrl')} <span className="text-wiki-muted">({t('settingsOptional')})</span>
        </label>
        <input
          type="text"
          value={config.llm.apiBaseUrl}
          onChange={e => updateLocal('llm', { apiBaseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
        />
      </div>

      <div className="border-t border-wiki-border pt-4 space-y-4">
        <SettingRow label={t('settingsTemperature')} description={t('settingsTemperatureDesc')}>
          <NumberInput value={config.llm.temperature} onChange={v => updateLocal('llm', { temperature: v })} min={0} max={2} step={0.1} />
        </SettingRow>
        <SettingRow label={t('settingsMaxTokens')} description={t('settingsMaxTokensDesc')}>
          <NumberInput value={config.llm.maxTokens} onChange={v => updateLocal('llm', { maxTokens: v })} min={256} max={128000} step={256} />
        </SettingRow>
        <SettingRow label={t('settingsContextWindow')} description={t('settingsContextWindowDesc')}>
          <NumberInput value={config.llm.contextWindow} onChange={v => updateLocal('llm', { contextWindow: v })} min={1000} max={100000} step={1000} />
        </SettingRow>
        <SettingRow label={t('settingsStreamResponse')} description={t('settingsStreamResponseDesc')}>
          <Toggle checked={config.llm.streamResponse} onChange={v => updateLocal('llm', { streamResponse: v })} />
        </SettingRow>
      </div>
    </>
  )
}

function IndexingSettings({ config, updateLocal }: TabProps) {
  const [newExt, setNewExt] = useState('')
  const [newDir, setNewDir] = useState('')
  const [newPattern, setNewPattern] = useState('')

  return (
    <>
      <SettingRow label={t('settingsMaxDepth')} description={t('settingsMaxDepthDesc')}>
        <NumberInput value={config.indexing.maxDepth} onChange={v => updateLocal('indexing', { maxDepth: v })} min={1} max={20} />
      </SettingRow>
      <SettingRow label={t('settingsMaxFileSize')} description={t('settingsMaxFileSizeDesc')}>
        <NumberInput value={config.indexing.maxFileSize} onChange={v => updateLocal('indexing', { maxFileSize: v })} min={1000} max={10000000} step={10000} />
      </SettingRow>
      <SettingRow label={t('settingsAutoReindex')} description={t('settingsAutoReindexDesc')}>
        <Toggle checked={config.indexing.autoReindex} onChange={v => updateLocal('indexing', { autoReindex: v })} />
      </SettingRow>
      <SettingRow label={t('settingsWatchMode')} description={t('settingsWatchModeDesc')}>
        <Toggle checked={config.indexing.watchMode} onChange={v => updateLocal('indexing', { watchMode: v })} />
      </SettingRow>

      {/* File Extensions */}
      <div className="border-t border-wiki-border pt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-2 text-sm font-medium text-wiki-text">
            <FileCode size={14} />
            {t('settingsFileExtensions')} ({config.indexing.extensions.length})
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {config.indexing.extensions.map(ext => (
            <span key={ext} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wiki-card border border-wiki-border text-xs text-wiki-muted">
              {ext}
              <button onClick={() => updateLocal('indexing', { extensions: config.indexing.extensions.filter(e => e !== ext) })} className="text-wiki-muted/50 hover:text-red-400">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newExt}
            onChange={e => setNewExt(e.target.value)}
            placeholder=".ext"
            className="flex-1 px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-xs text-wiki-text focus:outline-none focus:border-wiki-accent"
            onKeyDown={e => {
              if (e.key === 'Enter' && newExt.trim()) {
                const ext = newExt.trim().startsWith('.') ? newExt.trim() : `.${newExt.trim()}`
                if (!config.indexing.extensions.includes(ext)) {
                  updateLocal('indexing', { extensions: [...config.indexing.extensions, ext] })
                }
                setNewExt('')
              }
            }}
          />
        </div>
      </div>

      {/* Ignored Directories */}
      <div className="border-t border-wiki-border pt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-wiki-text">
            {t('settingsIgnoredDirs')} ({config.indexing.ignoreDirs.length})
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {config.indexing.ignoreDirs.map(dir => (
            <span key={dir} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wiki-card border border-wiki-border text-xs text-wiki-muted">
              {dir}
              <button onClick={() => updateLocal('indexing', { ignoreDirs: config.indexing.ignoreDirs.filter(d => d !== dir) })} className="text-wiki-muted/50 hover:text-red-400">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newDir}
            onChange={e => setNewDir(e.target.value)}
            placeholder="dirname"
            className="flex-1 px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-xs text-wiki-text focus:outline-none focus:border-wiki-accent"
            onKeyDown={e => {
              if (e.key === 'Enter' && newDir.trim()) {
                if (!config.indexing.ignoreDirs.includes(newDir.trim())) {
                  updateLocal('indexing', { ignoreDirs: [...config.indexing.ignoreDirs, newDir.trim()] })
                }
                setNewDir('')
              }
            }}
          />
        </div>
      </div>

      {/* Ignore Patterns (glob, applied like .codewikiignore) */}
      <div className="border-t border-wiki-border pt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-wiki-text">
            {t('settingsIgnorePatterns')} ({config.indexing.ignorePatterns.length})
          </label>
        </div>
        <p className="text-xs text-wiki-muted/70 mb-2">{t('settingsIgnorePatternsDesc')}</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {config.indexing.ignorePatterns.map(pat => (
            <span key={pat} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-wiki-card border border-wiki-border text-xs text-wiki-muted">
              {pat}
              <button onClick={() => updateLocal('indexing', { ignorePatterns: config.indexing.ignorePatterns.filter(p => p !== pat) })} className="text-wiki-muted/50 hover:text-red-400">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
            placeholder="*.test.ts"
            className="flex-1 px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-xs text-wiki-text focus:outline-none focus:border-wiki-accent"
            onKeyDown={e => {
              if (e.key === 'Enter' && newPattern.trim()) {
                if (!config.indexing.ignorePatterns.includes(newPattern.trim())) {
                  updateLocal('indexing', { ignorePatterns: [...config.indexing.ignorePatterns, newPattern.trim()] })
                }
                setNewPattern('')
              }
            }}
          />
        </div>
      </div>
    </>
  )
}

function OntologySettings({ config, updateLocal }: TabProps) {
  return (
    <>
      <SettingRow label={t('settingsImpactDepth')} description={t('settingsImpactDepthDesc')}>
        <NumberInput value={config.ontology.impactDepth} onChange={v => updateLocal('ontology', { impactDepth: v })} min={1} max={10} />
      </SettingRow>
      <SettingRow label={t('settingsWarnEntities')} description={t('settingsWarnEntitiesDesc')}>
        <NumberInput value={config.ontology.warningThreshold.entities} onChange={v => updateLocal('ontology', { warningThreshold: { ...config.ontology.warningThreshold, entities: v } })} min={1} max={100} />
      </SettingRow>
      <SettingRow label={t('settingsWarnFiles')} description={t('settingsWarnFilesDesc')}>
        <NumberInput value={config.ontology.warningThreshold.files} onChange={v => updateLocal('ontology', { warningThreshold: { ...config.ontology.warningThreshold, files: v } })} min={1} max={50} />
      </SettingRow>
      <SettingRow label={t('settingsExtractDecorators')} description={t('settingsExtractDecoratorsDesc')}>
        <Toggle checked={config.ontology.extractDecorators} onChange={v => updateLocal('ontology', { extractDecorators: v })} />
      </SettingRow>
      <SettingRow label={t('settingsExtractArrow')} description={t('settingsExtractArrowDesc')}>
        <Toggle checked={config.ontology.extractArrowFunctions} onChange={v => updateLocal('ontology', { extractArrowFunctions: v })} />
      </SettingRow>
    </>
  )
}

function WikiSettings({ config, updateLocal }: TabProps) {
  const templates = listWikiTemplates()
  const active = templates.find(t => t.id === config.wiki.promptStyle) || templates[0]
  return (
    <>
      <SettingRow label={t('settingsWikiStyle')} description={t('settingsWikiStyleDesc')}>
        <SelectInput
          value={config.wiki.promptStyle}
          options={templates.map(t => ({ value: t.id, label: t.label }))}
          onChange={v => updateLocal('wiki', { promptStyle: v as typeof config.wiki.promptStyle })}
        />
      </SettingRow>
      <div className="rounded-lg border border-wiki-border bg-wiki-bg p-3 text-xs text-wiki-muted leading-relaxed">
        {active.description}
      </div>
      <SettingRow label={t('settingsPageCount')} description={t('settingsPageCountDesc')}>
        <NumberInput value={config.wiki.pageCount} onChange={v => updateLocal('wiki', { pageCount: v })} min={1} max={20} />
      </SettingRow>
      <SettingRow label={t('settingsIncludeMermaid')} description={t('settingsIncludeMermaidDesc')}>
        <Toggle checked={config.wiki.includeMermaid} onChange={v => updateLocal('wiki', { includeMermaid: v })} />
      </SettingRow>
      <SettingRow label={t('settingsAutoGenerate')} description={t('settingsAutoGenerateDesc')}>
        <Toggle checked={config.wiki.autoGenerate} onChange={v => updateLocal('wiki', { autoGenerate: v })} />
      </SettingRow>
    </>
  )
}

function SearchSettings({ config, updateLocal }: TabProps) {
  return (
    <>
      <SettingRow label={t('settingsMaxResults')} description={t('settingsMaxResultsDesc')}>
        <NumberInput value={config.search.maxResults} onChange={v => updateLocal('search', { maxResults: v })} min={1} max={100} />
      </SettingRow>
      <SettingRow label={t('settingsMinScore')} description={t('settingsMinScoreDesc')}>
        <NumberInput value={config.search.minScore} onChange={v => updateLocal('search', { minScore: v })} min={0} max={1} step={0.01} />
      </SettingRow>
      <SettingRow label={t('settingsSnippetLength')} description={t('settingsSnippetLengthDesc')}>
        <NumberInput value={config.search.snippetLength} onChange={v => updateLocal('search', { snippetLength: v })} min={100} max={2000} step={100} />
      </SettingRow>
      <SettingRow label={t('settingsHybridSearch')} description={t('settingsHybridSearchDesc')}>
        <Toggle checked={config.search.useEmbeddings} onChange={v => updateLocal('search', { useEmbeddings: v })} />
      </SettingRow>
      {config.search.useEmbeddings && (
        <div className="space-y-4 pl-1 border-l-2 border-wiki-accent/30 ml-1">
          <div className="pl-3 space-y-4">
            <SettingRow label={t('settingsEmbedProvider')} description={t('settingsEmbedProviderDesc')}>
              <SelectInput
                value={config.embeddings.provider}
                options={[
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'ollama', label: 'Ollama (Local)' },
                ]}
                onChange={v => updateLocal('embeddings', { provider: v as typeof config.embeddings.provider })}
              />
            </SettingRow>
            <div>
              <label className="text-sm text-wiki-text mb-1 block">{t('settingsEmbedModel')}</label>
              <input
                type="text" value={config.embeddings.model}
                onChange={e => updateLocal('embeddings', { model: e.target.value })}
                placeholder="text-embedding-3-small"
                className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
              />
              <p className="text-xs text-wiki-muted mt-1">{t('settingsEmbedModelDesc')}</p>
            </div>
            <div>
              <label className="text-sm text-wiki-text mb-1 block">{t('settingsEmbedBaseUrl')}</label>
              <input
                type="text" value={config.embeddings.baseUrl}
                onChange={e => updateLocal('embeddings', { baseUrl: e.target.value })}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
              />
              <p className="text-xs text-wiki-muted mt-1">{t('settingsEmbedBaseUrlDesc')}</p>
            </div>
            <SettingRow label={t('settingsRrfK')} description={t('settingsRrfKDesc')}>
              <NumberInput value={config.embeddings.rrfK} onChange={v => updateLocal('embeddings', { rrfK: v })} min={1} max={200} step={1} />
            </SettingRow>
          </div>
        </div>
      )}

      <div className="border-t border-wiki-border pt-4 space-y-4">
        <h4 className="text-sm font-medium text-wiki-text flex items-center gap-2">
          <GitBranch size={14} />
          {t('settingsKnowledgeGraph')}
        </h4>
        <SettingRow label={t('settingsRender3D')} description={t('settingsRender3DDesc')}>
          <Toggle checked={config.graph.render3D} onChange={v => updateLocal('graph', { render3D: v })} />
        </SettingRow>
        <SettingRow label={t('settingsShowLabels')} description={t('settingsShowLabelsDesc')}>
          <Toggle checked={config.graph.showLabels} onChange={v => updateLocal('graph', { showLabels: v })} />
        </SettingRow>
        <SettingRow label={t('settingsNodeSize')} description={t('settingsNodeSizeDesc')}>
          <NumberInput value={config.graph.nodeSize} onChange={v => updateLocal('graph', { nodeSize: v })} min={0.5} max={4} step={0.1} />
        </SettingRow>
        {config.graph.render3D && (
          <SettingRow label={t('settingsRotationSpeed')} description={t('settingsRotationSpeedDesc')}>
            <NumberInput value={config.graph.rotationSpeed} onChange={v => updateLocal('graph', { rotationSpeed: v })} min={0} max={5} step={0.1} />
          </SettingRow>
        )}
        <SettingRow label={t('settingsForceStrength')} description={t('settingsForceStrengthDesc')}>
          <NumberInput value={config.graph.forceStrength} onChange={v => updateLocal('graph', { forceStrength: v })} min={-1000} max={0} step={10} />
        </SettingRow>
        <SettingRow label={t('settingsLinkDistance')} description={t('settingsLinkDistanceDesc')}>
          <NumberInput value={config.graph.linkDistance} onChange={v => updateLocal('graph', { linkDistance: v })} min={20} max={500} step={10} />
        </SettingRow>
        <SettingRow label={t('settingsMaxNodes')} description={t('settingsMaxNodesDesc')}>
          <NumberInput value={config.graph.maxNodes} onChange={v => updateLocal('graph', { maxNodes: v })} min={50} max={5000} step={50} />
        </SettingRow>
      </div>
    </>
  )
}

function UISettings({ config, updateLocal }: TabProps) {
  return (
    <>
      <SettingRow label={t('settingsTheme')} description={t('settingsThemeDesc')}>
        <SelectInput
          value={config.ui.theme}
          options={[
            { value: 'dark', label: t('settingsThemeDark') },
            { value: 'light', label: t('settingsThemeLight') },
            { value: 'system', label: t('settingsThemeSystem') },
          ]}
          onChange={v => updateLocal('ui', { theme: v })}
        />
      </SettingRow>
      <SettingRow label={t('settingsLanguage')} description={t('settingsLanguageDesc')}>
        <SelectInput
          value={config.ui.language}
          options={[
            { value: 'en', label: 'English' },
            { value: 'zh-CN', label: '简体中文' },
          ]}
          onChange={v => updateLocal('ui', { language: v })}
        />
      </SettingRow>
      <SettingRow label={t('settingsFontSize')} description={t('settingsFontSizeDesc')}>
        <NumberInput value={config.ui.fontSize} onChange={v => updateLocal('ui', { fontSize: v })} min={10} max={24} />
      </SettingRow>
      <SettingRow label={t('settingsSidebarWidth')} description={t('settingsSidebarWidthDesc')}>
        <NumberInput value={config.ui.sidebarWidth} onChange={v => updateLocal('ui', { sidebarWidth: v })} min={180} max={400} step={10} />
      </SettingRow>
      <SettingRow label={t('settingsSidebarPosition')} description={t('settingsSidebarPositionDesc')}>
        <SelectInput
          value={config.ui.sidebarPosition}
          options={[
            { value: 'left', label: t('settingsPosLeft') },
            { value: 'right', label: t('settingsPosRight') },
          ]}
          onChange={v => updateLocal('ui', { sidebarPosition: v })}
        />
      </SettingRow>
      <SettingRow label={t('settingsShowLineNumbers')} description={t('settingsShowLineNumbersDesc')}>
        <Toggle checked={config.ui.showLineNumbers} onChange={v => updateLocal('ui', { showLineNumbers: v })} />
      </SettingRow>
      <SettingRow label={t('settingsWordWrap')} description={t('settingsWordWrapDesc')}>
        <Toggle checked={config.ui.wordWrap} onChange={v => updateLocal('ui', { wordWrap: v })} />
      </SettingRow>
    </>
  )
}

function BehaviorSettings({ config, updateLocal }: TabProps) {
  return (
    <>
      <SettingRow label={t('settingsAutoSave')} description={t('settingsAutoSaveDesc')}>
        <Toggle checked={config.behavior.autoSave} onChange={v => updateLocal('behavior', { autoSave: v })} />
      </SettingRow>
      <SettingRow label={t('settingsAutoSaveInterval')} description={t('settingsAutoSaveIntervalDesc')}>
        <NumberInput value={config.behavior.autoSaveInterval / 1000} onChange={v => updateLocal('behavior', { autoSaveInterval: v * 1000 })} min={5} max={300} />
      </SettingRow>
      <SettingRow label={t('settingsConfirmApply')} description={t('settingsConfirmApplyDesc')}>
        <Toggle checked={config.behavior.confirmBeforeApply} onChange={v => updateLocal('behavior', { confirmBeforeApply: v })} />
      </SettingRow>
      <SettingRow label={t('settingsRememberProject')} description={t('settingsRememberProjectDesc')}>
        <Toggle checked={config.behavior.rememberLastProject} onChange={v => updateLocal('behavior', { rememberLastProject: v })} />
      </SettingRow>
      <SettingRow label={t('settingsMaxRecent')} description={t('settingsMaxRecentDesc')}>
        <NumberInput value={config.behavior.maxRecentProjects} onChange={v => updateLocal('behavior', { maxRecentProjects: v })} min={1} max={50} />
      </SettingRow>

      <div className="border-t border-wiki-border pt-4 space-y-4">
        <h4 className="text-sm font-medium text-wiki-text flex items-center gap-2">
          <Bell size={14} />
          {t('settingsNotifications')}
        </h4>
        <SettingRow label={t('settingsShowProgress')} description={t('settingsShowProgressDesc')}>
          <Toggle checked={config.notifications.showProgress} onChange={v => updateLocal('notifications', { showProgress: v })} />
        </SettingRow>
        <SettingRow label={t('settingsImpactWarning')} description={t('settingsImpactWarningDesc')}>
          <Toggle checked={config.notifications.showImpactWarning} onChange={v => updateLocal('notifications', { showImpactWarning: v })} />
        </SettingRow>
      </div>
    </>
  )
}

function VerifySettings({ config, updateLocal }: TabProps) {
  return (
    <>
      <SettingRow label={t('settingsVerifyEnable')} description={t('settingsVerifyEnableDesc')}>
        <Toggle checked={config.verify.enabled} onChange={v => updateLocal('verify', { enabled: v })} />
      </SettingRow>
      {config.verify.enabled && (
        <>
          <div>
            <label className="text-sm text-wiki-text mb-1 block">{t('settingsLintCommand')}</label>
            <input
              type="text" value={config.verify.lintCommand}
              onChange={e => updateLocal('verify', { lintCommand: e.target.value })}
              placeholder="e.g. npm run lint"
              className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
            />
          </div>
          <div>
            <label className="text-sm text-wiki-text mb-1 block">{t('settingsBuildCommand')}</label>
            <input
              type="text" value={config.verify.buildCommand}
              onChange={e => updateLocal('verify', { buildCommand: e.target.value })}
              placeholder="e.g. npm run build"
              className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
            />
          </div>
          <div>
            <label className="text-sm text-wiki-text mb-1 block">{t('settingsTestCommand')}</label>
            <input
              type="text" value={config.verify.testCommand}
              onChange={e => updateLocal('verify', { testCommand: e.target.value })}
              placeholder="e.g. npm test"
              className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
            />
          </div>
          <SettingRow label={t('settingsTimeout')} description={t('settingsTimeoutDesc')}>
            <NumberInput value={Math.round(config.verify.timeoutMs / 1000)} onChange={v => updateLocal('verify', { timeoutMs: v * 1000 })} min={5} max={1800} step={5} />
          </SettingRow>
        </>
      )}
    </>
  )
}

function PrivacySettings({ config, updateLocal }: TabProps) {
  return (
    <>
      <SettingRow label={t('settingsUseIgnoreFile')} description={t('settingsUseIgnoreFileDesc')}>
        <Toggle checked={config.privacy.useIgnoreFile} onChange={v => updateLocal('privacy', { useIgnoreFile: v })} />
      </SettingRow>
      <SettingRow label={t('settingsExcludeSensitive')} description={t('settingsExcludeSensitiveDesc')}>
        <Toggle checked={config.privacy.excludeSensitiveDefaults} onChange={v => updateLocal('privacy', { excludeSensitiveDefaults: v })} />
      </SettingRow>
      <SettingRow label={t('settingsRedactSecrets')} description={t('settingsRedactSecretsDesc')}>
        <Toggle checked={config.privacy.redactSecrets} onChange={v => updateLocal('privacy', { redactSecrets: v })} />
      </SettingRow>
      <div>
        <label className="text-sm text-wiki-text mb-1 block">{t('settingsExtraPatterns')}</label>
        <textarea
          value={config.privacy.extraPatterns.join('\n')}
          onChange={e => updateLocal('privacy', { extraPatterns: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
          placeholder={t('settingsExtraPatternsPlaceholder')}
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent resize-y"
        />
        <p className="text-xs text-wiki-muted mt-1">{t('settingsExtraPatternsDesc')}</p>
      </div>
    </>
  )
}

function buildMcpClientConfig(mcp: CodeWikiConfig['mcp']): string {
  const env: Record<string, string> = {}
  if (mcp.projectPath) env.PROJECT_PATH = mcp.projectPath
  if (mcp.logDir) env.CODEWIKI_LOG_DIR = mcp.logDir
  if (mcp.consumer) env.CODEWIKI_CONSUMER = mcp.consumer
  if (mcp.enabledTools.length > 0) env.CODEWIKI_ENABLED_TOOLS = mcp.enabledTools.join(',')
  const snippet = {
    mcpServers: {
      codewiki: {
        command: 'node',
        args: ['/absolute/path/to/codewiki/dist/server/mcp-server.js'],
        ...(mcp.transport === 'http' ? { transport: 'http', port: mcp.port } : {}),
        env,
      },
    },
  }
  return JSON.stringify(snippet, null, 2)
}

function McpSettings({ config, updateLocal }: TabProps) {
  const [copied, setCopied] = useState(false)
  const generated = buildMcpClientConfig(config.mcp)
  return (
    <>
      <SettingRow label={t('settingsMcpEnable')} description={t('settingsMcpEnableDesc')}>
        <Toggle checked={config.mcp.enabled} onChange={v => updateLocal('mcp', { enabled: v })} />
      </SettingRow>
      <SettingRow label={t('settingsMcpTransport')} description={t('settingsMcpTransportDesc')}>
        <SelectInput
          value={config.mcp.transport}
          options={[
            { value: 'stdio', label: 'stdio' },
            { value: 'http', label: 'http' },
          ]}
          onChange={v => updateLocal('mcp', { transport: v as typeof config.mcp.transport })}
        />
      </SettingRow>
      {config.mcp.transport === 'http' && (
        <SettingRow label={t('settingsMcpPort')} description={t('settingsMcpPortDesc')}>
          <NumberInput value={config.mcp.port} onChange={v => updateLocal('mcp', { port: v })} min={1024} max={65535} step={1} />
        </SettingRow>
      )}
      <div>
        <label className="text-sm text-wiki-text mb-1 block">{t('settingsMcpProjectPath')}</label>
        <input
          type="text" value={config.mcp.projectPath}
          onChange={e => updateLocal('mcp', { projectPath: e.target.value })}
          placeholder="/path/to/project"
          className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
        />
        <p className="text-xs text-wiki-muted mt-1">{t('settingsMcpProjectPathDesc')}</p>
      </div>
      <div>
        <label className="text-sm text-wiki-text mb-1 block">{t('settingsMcpLogDir')}</label>
        <input
          type="text" value={config.mcp.logDir}
          onChange={e => updateLocal('mcp', { logDir: e.target.value })}
          placeholder="~/.codewiki/logs"
          className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
        />
        <p className="text-xs text-wiki-muted mt-1">{t('settingsMcpLogDirDesc')}</p>
      </div>
      <SettingRow label={t('settingsMcpConsumer')} description={t('settingsMcpConsumerDesc')}>
        <input
          type="text" value={config.mcp.consumer}
          onChange={e => updateLocal('mcp', { consumer: e.target.value })}
          className="w-40 px-2 py-1 rounded bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text focus:outline-none focus:border-wiki-accent"
        />
      </SettingRow>
      <div>
        <label className="text-sm text-wiki-text mb-1 block">{t('settingsMcpTools')}</label>
        <textarea
          value={config.mcp.enabledTools.join('\n')}
          onChange={e => updateLocal('mcp', { enabledTools: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
          placeholder={t('settingsMcpToolsPlaceholder')}
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm font-mono text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent resize-y"
        />
        <p className="text-xs text-wiki-muted mt-1">{t('settingsMcpToolsDesc')}</p>
      </div>
      <div className="rounded-lg border border-wiki-border bg-wiki-bg p-3 text-xs text-wiki-muted leading-relaxed flex items-start gap-2">
        <Server size={14} className="mt-0.5 shrink-0" />
        <span>{t('settingsMcpDocsHint')}</span>
      </div>
      {/* Generated client config built from the settings above. */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm text-wiki-text">{t('settingsMcpGenerated')}</label>
          <button
            onClick={() => { void navigator.clipboard?.writeText(generated); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            className="text-xs px-2 py-0.5 rounded bg-wiki-card border border-wiki-border text-wiki-muted hover:text-wiki-accent hover:border-wiki-accent"
          >
            {copied ? t('copied') : t('copy')}
          </button>
        </div>
        <pre className="w-full px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-xs font-mono text-wiki-text overflow-x-auto whitespace-pre">{generated}</pre>
      </div>
    </>
  )
}
