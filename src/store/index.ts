import { create } from 'zustand'
import type { AppState } from './types'
import { createProjectSlice } from './project-slice'
import { createUiSlice } from './ui-slice'
import { createChatSlice } from './chat-slice'
import { createSearchSlice } from './search-slice'
import { createGraphSlice } from './graph-slice'
import { createSettingsSlice } from './settings-slice'

export type { AppState } from './types'

export const useAppStore = create<AppState>()((...a) => ({
  ...createProjectSlice(...a),
  ...createUiSlice(...a),
  ...createChatSlice(...a),
  ...createSearchSlice(...a),
  ...createGraphSlice(...a),
  ...createSettingsSlice(...a),
}))
