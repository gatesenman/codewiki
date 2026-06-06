import { useEffect } from 'react'
import { useAppStore } from './store'
import { Layout } from './components/Layout'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useProjectWatcher } from './hooks/useProjectWatcher'
import { t } from './services/i18n'

export default function App() {
  const currentProject = useAppStore(s => s.currentProject)
  const locale = useAppStore(s => s.locale)
  const config = useAppStore(s => s.config)
  const loadConfig = useAppStore(s => s.loadConfig)
  const loadRecentProjects = useAppStore(s => s.loadRecentProjects)

  // Auto incremental reindex on file changes (when "Auto Re-index" is enabled)
  useProjectWatcher()

  // Load saved config and recent projects on mount
  useEffect(() => {
    loadConfig()
    loadRecentProjects()
  }, [loadConfig, loadRecentProjects])

  // Apply theme
  useEffect(() => {
    const theme = config.ui.theme
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
      const listener = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
      }
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', listener)
      return () => window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', listener)
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [config.ui.theme])

  // Apply font size
  useEffect(() => {
    document.documentElement.style.fontSize = `${config.ui.fontSize}px`
  }, [config.ui.fontSize])

  // Update title and document language
  useEffect(() => {
    document.title = currentProject
      ? `${currentProject.name} - CodeWiki`
      : t('appWindowTitle')
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [currentProject, locale])

  return (
    <div className="h-screen w-screen overflow-hidden bg-wiki-bg text-wiki-text">
      {currentProject ? <Layout /> : <WelcomeScreen />}
    </div>
  )
}
