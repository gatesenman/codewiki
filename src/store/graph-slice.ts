import type { StateCreator } from 'zustand'
import type { GraphNode, GraphLink } from '../types'
import type { AppState } from './types'

export interface GraphSlice {
  graphNodes: GraphNode[]
  graphLinks: GraphLink[]
  selectedGraphNode: string | null
  selectedEntityId: string | null
  setGraphData: (nodes: GraphNode[], links: GraphLink[]) => void
  setSelectedGraphNode: (id: string | null) => void
  setSelectedEntityId: (id: string | null) => void
}

export const createGraphSlice: StateCreator<AppState, [], [], GraphSlice> = (set) => ({
  graphNodes: [],
  graphLinks: [],
  selectedGraphNode: null,
  selectedEntityId: null,
  setGraphData: (nodes, links) => set({ graphNodes: nodes, graphLinks: links }),
  setSelectedGraphNode: (id) => set({ selectedGraphNode: id }),
  setSelectedEntityId: (id) => set({ selectedEntityId: id }),
})
