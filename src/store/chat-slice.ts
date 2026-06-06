import type { StateCreator } from 'zustand'
import type { ChatMessage } from '../types'
import type { AppState } from './types'

export interface ChatSlice {
  chatMessages: ChatMessage[]
  addChatMessage: (message: ChatMessage) => void
  updateChatMessage: (id: string, content: string) => void
  clearChat: () => void
}

export const createChatSlice: StateCreator<AppState, [], [], ChatSlice> = (set) => ({
  chatMessages: [],
  addChatMessage: (message) => set((state) => ({ chatMessages: [...state.chatMessages, message] })),
  updateChatMessage: (id, content) => set((state) => ({
    chatMessages: state.chatMessages.map(m => m.id === id ? { ...m, content } : m),
  })),
  clearChat: () => set({ chatMessages: [] }),
})
