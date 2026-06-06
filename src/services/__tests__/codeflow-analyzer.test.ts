import { describe, it, expect } from 'vitest'
import {
  generateCodeFlowMaps,
  suggestCodeFlows,
  buildFlowFromSeeds,
} from '../codeflow-analyzer'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'comp-app', name: 'App', type: 'Component', filePath: 'src/App.tsx', line: 1, endLine: 30, signature: 'function App()' },
      { id: 'comp-home', name: 'Home', type: 'Component', filePath: 'src/pages/Home.tsx', line: 1, endLine: 20, signature: 'function Home()' },
      { id: 'fn-useAuth', name: 'useAuth', type: 'Function', filePath: 'src/hooks/useAuth.ts', line: 5, endLine: 40, signature: 'function useAuth(): AuthState' },
      { id: 'cls-api', name: 'ApiService', type: 'Class', filePath: 'src/services/api.ts', line: 1, endLine: 100, signature: 'class ApiService' },
      { id: 'fn-fetch', name: 'fetchData', type: 'Method', filePath: 'src/services/api.ts', line: 20, endLine: 40, signature: 'async fetchData(url: string)' },
      { id: 'fn-parse', name: 'parseResponse', type: 'Function', filePath: 'src/utils/parse.ts', line: 1, endLine: 15, signature: 'function parseResponse(res: Response)' },
      { id: 'fn-main', name: 'main', type: 'Function', filePath: 'src/main.ts', line: 1, endLine: 10, signature: 'function main()' },
    ],
    relations: [
      { id: 'r1', source: 'comp-app', target: 'comp-home', type: 'calls' },
      { id: 'r2', source: 'comp-home', target: 'fn-useAuth', type: 'calls' },
      { id: 'r3', source: 'fn-useAuth', target: 'cls-api', type: 'uses' },
      { id: 'r4', source: 'cls-api', target: 'fn-fetch', type: 'contains' },
      { id: 'r5', source: 'fn-fetch', target: 'fn-parse', type: 'calls' },
      { id: 'r6', source: 'fn-main', target: 'comp-app', type: 'calls' },
      { id: 'r7', source: 'src/App.tsx', target: 'comp-app', type: 'exports' },
      { id: 'r8', source: 'src/main.ts', target: 'fn-main', type: 'exports' },
    ],
  }
}

describe('codeflow-analyzer', () => {
  const graph = makeGraph()

  describe('generateCodeFlowMaps', () => {
    it('generates at least one flow map', () => {
      const flows = generateCodeFlowMaps(graph)
      expect(flows.length).toBeGreaterThan(0)
    })

    it('flow maps have sections with steps', () => {
      const flows = generateCodeFlowMaps(graph)
      for (const flow of flows) {
        expect(flow.title).toBeTruthy()
        expect(flow.sections.length).toBeGreaterThan(0)
        for (const section of flow.sections) {
          expect(section.sectionNumber).toBeGreaterThan(0)
          expect(section.steps.length).toBeGreaterThan(0)
          for (const step of section.steps) {
            expect(step.stepId).toMatch(/^\d+[a-z]$/)
            expect(step.label).toBeTruthy()
            expect(step.filePath).toBeTruthy()
            expect(step.fileRef).toBeTruthy()
          }
        }
      }
    })

    it('steps contain entity references', () => {
      const flows = generateCodeFlowMaps(graph)
      const allSteps = flows.flatMap(f => f.sections.flatMap(s => s.steps))
      expect(allSteps.some(s => s.entityType === 'Component')).toBe(true)
    })
  })

  describe('suggestCodeFlows', () => {
    it('returns suggestions', () => {
      const suggestions = suggestCodeFlows(graph)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('suggests component flow', () => {
      const suggestions = suggestCodeFlows(graph)
      const compSug = suggestions.find(s => s.title.includes('Component'))
      expect(compSug).toBeDefined()
    })

    it('suggests entry point flow', () => {
      const suggestions = suggestCodeFlows(graph)
      const entrySug = suggestions.find(s => s.title.includes('Entry Point'))
      expect(entrySug).toBeDefined()
    })

    it('each suggestion has seed entity IDs', () => {
      const suggestions = suggestCodeFlows(graph)
      for (const sug of suggestions) {
        expect(sug.seedEntityIds.length).toBeGreaterThan(0)
      }
    })
  })

  describe('buildFlowFromSeeds', () => {
    it('builds a flow from a single seed', () => {
      const flow = buildFlowFromSeeds(graph, ['comp-app'], 'Test Flow', 'desc')
      expect(flow.title).toBe('Test Flow')
      expect(flow.sections.length).toBeGreaterThan(0)
    })

    it('steps follow BFS order from seed', () => {
      const flow = buildFlowFromSeeds(graph, ['comp-app'], 'BFS Test', 'desc')
      const steps = flow.sections.flatMap(s => s.steps)
      expect(steps[0].entityName).toBe('App')
    })

    it('assigns incrementing step IDs', () => {
      const flow = buildFlowFromSeeds(graph, ['comp-app'], 'ID Test', 'desc')
      const steps = flow.sections[0].steps
      expect(steps[0].stepId).toBe('1a')
      if (steps.length > 1) expect(steps[1].stepId).toBe('1b')
    })

    it('builds flow from multiple seeds', () => {
      const flow = buildFlowFromSeeds(
        graph,
        ['comp-app', 'cls-api'],
        'Multi Seed',
        'desc',
      )
      expect(flow.sections.length).toBeGreaterThanOrEqual(1)
    })

    it('returns empty sections for unknown seed', () => {
      const flow = buildFlowFromSeeds(graph, ['nonexistent'], 'No Seed', 'desc')
      expect(flow.sections.length).toBe(0)
    })
  })
})
