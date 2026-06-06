import { useState } from 'react'
import {
  BookOpen, GitBranch, Search, MessageSquare, Bot,
  Loader2, Settings, PanelLeftClose, PanelLeftOpen,
  RefreshCw, FolderOpen, Home,
} from 'lucide-react'
import { useAppStore } from '../store'
import { SettingsModal } from './SettingsModal'
import { services } from '../services/service-registry'

const VIEW_TABS = [
  { mode: 'wiki' as const, label: 'Wiki', icon: BookOpen },
  { mode: 'graph' as const, label: 'Graph', icon: GitBranch },
  { mode: 'search' as const, label: 'Search', icon: Search },
  { mode: 'chat' as const, label: 'Chat', icon: MessageSquare },
  { mode: 'agent' as const, label: 'Agent', icon: Bot },
]

export function TopBar() {
  const {
    viewMode, setViewMode,
    currentProject, setCurrentProject,
    sidebarCollapsed, toggleSidebar,
    isLoading, loadingMessage,
    updateProject, setLoading,
  } = useAppStore()
  const [showSettings, setShowSettings] = useState(false)
  const [isReindexing, setIsReindexing] = useState(false)

  const handleGenerateWiki = async () => {
    if (!currentProject) return
    try {
      const { settings } = useAppStore.getState()
      if (!settings.apiKey && settings.llmProvider !== 'ollama') {
        alert('Please configure your API key in Settings first.')
        setShowSettings(true)
        return
      }
      updateProject({ ...currentProject, status: 'generating' })
      setLoading(true, 'Generating wiki...')
      const llm = services.getLLMService(settings)
      const { WikiGenerator } = await import('../services/wiki-generator')
      const { configManager } = await import('../services/config-manager')
      const wikiGen = new WikiGenerator(llm, configManager.get('wiki').promptStyle)
      const readFile = async (filePath: string) => {
        if (window.electronAPI?.readFile) return window.electronAPI.readFile(filePath)
        return null
      }
      const pages = await wikiGen.generateWiki(currentProject, [], readFile)
      updateProject({
        ...currentProject,
        wikiPages: pages,
        status: 'ready',
        generatedAt: Date.now(),
      })
      setLoading(false)
    } catch (err) {
      updateProject({ ...currentProject, status: 'error', error: String(err) })
      setLoading(false)
    }
  }

  const handleReindex = async () => {
    if (!currentProject || isReindexing) return
    try {
      setIsReindexing(true)
      setLoading(true, 'Re-indexing project...')
      const { CodeIndexer } = await import('../services/indexer')
      const indexer = new CodeIndexer()
      const project = await indexer.indexLocalProject(currentProject.path, () => {}, { forceFull: true })
      updateProject({ ...project, id: currentProject.id, wikiPages: currentProject.wikiPages })
      setLoading(false)
      setIsReindexing(false)
    } catch (err) {
      console.error('Re-index failed:', err)
      setLoading(false)
      setIsReindexing(false)
    }
  }

  const handleBackToWelcome = () => {
    setCurrentProject(null)
    services.reset()
  }

  return (
    <>
      <div className="h-12 border-b border-wiki-border bg-wiki-sidebar flex items-center px-3 gap-2 shrink-0">
        {/* Sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-wiki-card text-wiki-muted hover:text-wiki-text transition-colors"
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        {/* Home button */}
        <button
          onClick={handleBackToWelcome}
          className="p-1.5 rounded-md hover:bg-wiki-card text-wiki-muted hover:text-wiki-text transition-colors"
          title="Back to projects"
        >
          <Home size={16} />
        </button>

        {/* Project name */}
        {currentProject && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-wiki-card border border-wiki-border">
            <FolderOpen size={12} className="text-wiki-accent" />
            <span className="text-xs font-medium text-wiki-text truncate max-w-[150px]">{currentProject.name}</span>
          </div>
        )}

        {/* Divider */}
        <div className="w-px h-5 bg-wiki-border mx-1" />

        {/* View tabs */}
        <div className="flex items-center gap-0.5">
          {VIEW_TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.mode}
                onClick={() => setViewMode(tab.mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === tab.mode
                    ? 'bg-wiki-accent/10 text-wiki-accent'
                    : 'text-wiki-muted hover:text-wiki-text hover:bg-wiki-card/50'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        {/* Re-index button */}
        <button
          onClick={handleReindex}
          disabled={isReindexing}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-wiki-muted hover:text-wiki-text hover:bg-wiki-card transition-colors disabled:opacity-50"
          title="Re-index project"
        >
          <RefreshCw size={14} className={isReindexing ? 'animate-spin' : ''} />
          Re-index
        </button>

        {/* Generate Wiki button */}
        {viewMode === 'wiki' && (
          <button
            onClick={handleGenerateWiki}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-wiki-accent/10 text-wiki-accent hover:bg-wiki-accent/20 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <BookOpen size={14} />
            Generate Wiki
          </button>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-wiki-muted">
            <Loader2 size={14} className="animate-spin" />
            <span className="max-w-[150px] truncate">{loadingMessage}</span>
          </div>
        )}

        {/* Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded-md hover:bg-wiki-card text-wiki-muted hover:text-wiki-text transition-colors"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}
