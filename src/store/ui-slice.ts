import type { StateCreator } from 'zustand'
import type { AppState } from './types'

export type ViewMode = 'wiki' | 'graph' | 'search' | 'chat' | 'agent' | 'insights' | 'codemap' | 'symbolwiki' | 'codeflow'

export interface UiSlice {
  viewMode: ViewMode
  sidebarCollapsed: boolean
  isLoading: boolean
  loadingMessage: string
  setViewMode: (mode: ViewMode) => void
  toggleSidebar: () => void
  setLoading: (loading: boolean, message?: string) => void
}

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  viewMode: 'wiki',
  sidebarCollapsed: false,
  isLoading: false,
  loadingMessage: '',
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),
})
