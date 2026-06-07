import { useState, useEffect, useRef } from 'react'
import {
  FolderOpen, Github, BookOpen, Cpu, Search, GitBranch,
  Loader2, Settings, ChevronRight, Clock, Trash2, Box,
} from 'lucide-react'
import { useAppStore } from '../store'
import { CodeIndexer } from '../services/indexer'
import type { IndexProgress } from '../services/indexer'
import { SettingsModal } from './SettingsModal'
import { playCompletionSound } from '../services/notify'
import { t } from '../services/i18n'

export function WelcomeScreen() {
  const addProject = useAppStore(s => s.addProject)
  const setLoading = useAppStore(s => s.setLoading)
  const saveProject = useAppStore(s => s.saveProject)
  const recentProjects = useAppStore(s => s.recentProjects)
  const removeRecentProject = useAppStore(s => s.removeRecentProject)
  useAppStore(s => s.locale)
  const showWelcomeIntro = useAppStore(s => s.config.behavior.showWelcome)
  const rememberLastProject = useAppStore(s => s.config.behavior.rememberLastProject)
  const showProgress = useAppStore(s => s.config.notifications.showProgress)
  const [repoUrl, setRepoUrl] = useState('')
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const autoOpened = useRef(false)

  const handleSelectFolder = async () => {
    try {
      setError(null)
      const folderPath = await window.electronAPI.selectFolder()
      if (!folderPath) return

      setLoading(true, t('loadingIndexing'))
      const indexer = new CodeIndexer()
      const project = await indexer.indexLocalProject(folderPath, (p) => {
        setProgress(p)
      })
      addProject(project)
      setLoading(false)
      playCompletionSound()
      setTimeout(() => saveProject(), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errIndexFailed'))
      setLoading(false)
    }
  }

  const handleGitHubUrl = async () => {
    if (!repoUrl.includes('github.com')) {
      setError(t('errInvalidGithubUrl'))
      return
    }
    try {
      setError(null)
      setLoading(true, t('loadingFetching'))
      const indexer = new CodeIndexer()
      const project = await indexer.indexGitHubRepo(repoUrl, (p) => {
        setProgress(p)
      })
      addProject(project)
      setLoading(false)
      playCompletionSound()
      setTimeout(() => saveProject(), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errFetchFailed'))
      setLoading(false)
    }
  }

  const handleOpenRecent = async (projectPath: string, projectType: 'local' | 'github') => {
    try {
      setError(null)
      setLoading(true, t('loadingReindexing'))
      const indexer = new CodeIndexer()
      if (projectType === 'local') {
        const project = await indexer.indexLocalProject(projectPath, (p) => setProgress(p))
        addProject(project)
      } else {
        const project = await indexer.indexGitHubRepo(projectPath, (p) => setProgress(p))
        addProject(project)
      }
      setLoading(false)
      playCompletionSound()
      setTimeout(() => saveProject(), 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errOpenFailed'))
      setLoading(false)
    }
  }

  // Reopen the most recent project on startup when enabled.
  useEffect(() => {
    if (autoOpened.current) return
    if (!rememberLastProject || recentProjects.length === 0) return
    autoOpened.current = true
    const last = recentProjects[0]
    void handleOpenRecent(last.path, last.type)
  }, [rememberLastProject, recentProjects]) // eslint-disable-line

  return (
    <div className="h-full w-full flex flex-col items-center justify-center relative overflow-y-auto fade-in">
      {/* Settings button */}
      <button
        onClick={() => setShowSettings(true)}
        className="absolute top-4 right-4 p-2 rounded-lg hover:bg-wiki-card text-wiki-muted hover:text-wiki-text transition-all duration-200 hover:rotate-45"
        title={t('settings')}
      >
        <Settings size={20} />
      </button>

      {/* Logo & Title */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-wiki-accent/20 to-wiki-purple/20 backdrop-blur">
            <BookOpen size={48} className="text-wiki-accent" />
          </div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-wiki-accent to-wiki-purple bg-clip-text text-transparent">
            CodeWiki
          </h1>
        </div>
        {showWelcomeIntro && (
          <p className="text-wiki-muted text-lg max-w-xl leading-relaxed">
            {t('welcomeDescription')}
          </p>
        )}
      </div>

      {/* Feature badges */}
      {showWelcomeIntro && (
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {[
            { icon: <Cpu size={16} />, label: t('featOntology') },
            { icon: <Search size={16} />, label: t('featSemantic') },
            { icon: <GitBranch size={16} />, label: t('featGraph') },
            { icon: <Box size={16} />, label: t('featImpact') },
          ].map((feat) => (
            <div key={feat.label} className="flex items-center gap-2 px-4 py-2 rounded-full bg-wiki-card/50 border border-wiki-border text-sm text-wiki-muted hover:border-wiki-accent/30 hover:text-wiki-accent transition-all duration-200 cursor-default">
              {feat.icon}
              {feat.label}
            </div>
          ))}
        </div>
      )}

      {/* Input cards */}
      <div className="flex gap-6 max-w-3xl w-full px-8 mb-8">
        {/* Local folder */}
        <button
          onClick={handleSelectFolder}
          disabled={progress !== null}
          className="flex-1 group p-6 rounded-xl border border-wiki-border bg-wiki-card hover:border-wiki-accent/50 transition-all duration-200 cursor-pointer text-left card-hover"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-wiki-accent/10 text-wiki-accent group-hover:bg-wiki-accent/20 transition-colors">
              <FolderOpen size={24} />
            </div>
            <h3 className="text-lg font-semibold text-wiki-text">{t('welcomeOpenLocal')}</h3>
            <ChevronRight size={18} className="ml-auto text-wiki-muted group-hover:text-wiki-accent group-hover:translate-x-1 transition-all" />
          </div>
          <p className="text-sm text-wiki-muted">
            {t('welcomeOpenLocalDesc')}
          </p>
        </button>

        {/* GitHub URL */}
        <div className="flex-1 p-6 rounded-xl border border-wiki-border bg-wiki-card card-hover">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-wiki-purple/10 text-wiki-purple">
              <Github size={24} />
            </div>
            <h3 className="text-lg font-semibold text-wiki-text">{t('welcomeGithub')}</h3>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGitHubUrl()}
              className="flex-1 px-3 py-2 rounded-lg bg-wiki-bg border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
            />
            <button
              onClick={handleGitHubUrl}
              disabled={!repoUrl || progress !== null}
              className="px-4 py-2 rounded-lg bg-wiki-purple text-white text-sm font-medium hover:bg-wiki-purple/80 disabled:opacity-50 transition-colors"
            >
              {t('welcomeGo')}
            </button>
          </div>
        </div>
      </div>

      {/* Recent Projects */}
      {recentProjects.length > 0 && (
        <div className="max-w-3xl w-full px-8 mb-8">
          <h3 className="text-sm font-semibold text-wiki-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock size={14} />
            {t('recentProjects')}
          </h3>
          <div className="space-y-1.5">
            {recentProjects.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-wiki-border bg-wiki-card hover:border-wiki-accent/30 transition-colors group cursor-pointer"
                onClick={() => handleOpenRecent(project.path, project.type)}
              >
                <div className={`p-1.5 rounded ${project.type === 'github' ? 'bg-wiki-purple/10 text-wiki-purple' : 'bg-wiki-accent/10 text-wiki-accent'}`}>
                  {project.type === 'github' ? <Github size={14} /> : <FolderOpen size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-wiki-text truncate">{project.name}</div>
                  <div className="text-xs text-wiki-muted truncate">{project.path}</div>
                </div>
                <div className="flex items-center gap-3 text-xs text-wiki-muted">
                  {project.entityCount !== undefined && (
                    <span className="flex items-center gap-1">
                      <Box size={10} />
                      {project.entityCount}
                    </span>
                  )}
                  <span>{new Date(project.lastOpened).toLocaleDateString()}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeRecentProject(project.id) }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-wiki-bg text-wiki-muted hover:text-red-400 transition-all"
                    title={t('welcomeRemoveRecent')}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {progress && showProgress && (
        <div className="max-w-3xl w-full px-8 mb-4">
          <div className="p-4 rounded-lg bg-wiki-card border border-wiki-border">
            <div className="flex items-center gap-3 mb-2">
              <Loader2 size={16} className="animate-spin text-wiki-accent" />
              <span className="text-sm text-wiki-text">{progress.message}</span>
            </div>
            {progress.total > 0 && (
              <div className="w-full h-1.5 bg-wiki-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-wiki-accent rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="max-w-3xl w-full px-8">
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
