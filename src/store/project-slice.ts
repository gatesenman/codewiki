import type { StateCreator } from 'zustand'
import type { WikiProject, RecentProject } from '../types'
import { configManager } from '../services/config-manager'
import type { AppState } from './types'

const RECENT_PROJECTS_KEY = 'codewiki-recent-projects'

export interface ProjectSlice {
  currentProject: WikiProject | null
  projects: WikiProject[]
  recentProjects: RecentProject[]
  activePageId: string | null
  setCurrentProject: (project: WikiProject | null) => void
  updateProject: (project: WikiProject) => void
  addProject: (project: WikiProject) => void
  addRecentProject: (project: WikiProject) => void
  removeRecentProject: (id: string) => void
  loadRecentProjects: () => void
  setActivePageId: (id: string | null) => void
}

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  currentProject: null,
  projects: [],
  recentProjects: [],
  activePageId: null,
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
  setActivePageId: (id) => set({ activePageId: id }),
})
