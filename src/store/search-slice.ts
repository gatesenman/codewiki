import type { StateCreator } from 'zustand'
import type { SearchResult } from '../types'
import type { AppState } from './types'

const SEARCH_HISTORY_KEY = 'codewiki-search-history'

export interface SearchSlice {
  searchQuery: string
  searchResults: SearchResult[]
  searchHistory: string[]
  setSearchQuery: (query: string) => void
  setSearchResults: (results: SearchResult[]) => void
  addSearchHistory: (query: string) => void
}

export const createSearchSlice: StateCreator<AppState, [], [], SearchSlice> = (set) => ({
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
})
