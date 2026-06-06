import type { ProjectSlice } from './project-slice'
import type { UiSlice } from './ui-slice'
import type { ChatSlice } from './chat-slice'
import type { SearchSlice } from './search-slice'
import type { GraphSlice } from './graph-slice'
import type { SettingsSlice } from './settings-slice'

export type AppState = ProjectSlice & UiSlice & ChatSlice & SearchSlice & GraphSlice & SettingsSlice
