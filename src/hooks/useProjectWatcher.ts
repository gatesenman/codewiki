/**
 * useProjectWatcher
 *
 * When "Auto Re-index" is enabled and a local project is open, watch the
 * project folder (via the Electron bridge) and run an incremental reindex
 * whenever files change. The reindex reuses the persistent index cache, so
 * only changed/added/removed files do real work.
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'

export function useProjectWatcher(): void {
  const projectPath = useAppStore(s => s.currentProject?.path)
  const projectType = useAppStore(s => s.currentProject?.type)
  const autoReindex = useAppStore(s => s.config.indexing.autoReindex)
  const watchMode = useAppStore(s => s.config.indexing.watchMode)
  const updateProject = useAppStore(s => s.updateProject)

  const running = useRef(false)
  const queued = useRef(false)

  // Watching is enabled by either the high-level "Auto Re-index" toggle or the
  // lower-level "Watch Mode" toggle.
  const watchEnabled = autoReindex || watchMode

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.watchProject || !projectPath || projectType !== 'local' || !watchEnabled) return

    let disposed = false

    const reindex = async () => {
      if (running.current) { queued.current = true; return }
      running.current = true
      try {
        const { CodeIndexer } = await import('../services/indexer')
        const indexer = new CodeIndexer()
        const project = await indexer.indexLocalProject(projectPath, () => {})
        if (!disposed) {
          const cur = useAppStore.getState().currentProject
          if (cur && cur.path === projectPath) {
            updateProject({ ...project, id: cur.id, wikiPages: cur.wikiPages })
          }
        }
      } catch (err) {
        console.error('[watcher] auto reindex failed:', err)
      } finally {
        running.current = false
        if (queued.current && !disposed) { queued.current = false; reindex() }
      }
    }

    void api.watchProject(projectPath)
    const unsubscribe = api.onProjectFilesChanged(changedPath => {
      if (changedPath === projectPath) void reindex()
    })

    return () => {
      disposed = true
      unsubscribe?.()
      void api.unwatchProject?.(projectPath)
    }
  }, [projectPath, projectType, watchEnabled, updateProject])
}
