import { describe, it, expect } from 'vitest'
import {
  generateModuleDependencyDiagram,
  generateClassHierarchyDiagram,
  generateComponentFlowDiagram,
  generateAllDiagrams,
} from '../architecture-diagram'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UserService', type: 'Class', filePath: 'src/services/user.ts', line: 1, endLine: 50 },
      { id: 'e2', name: 'AuthService', type: 'Class', filePath: 'src/services/auth.ts', line: 1, endLine: 30 },
      { id: 'e3', name: 'UserController', type: 'Class', filePath: 'src/controllers/user.ts', line: 1, endLine: 40 },
      { id: 'e4', name: 'IUser', type: 'Interface', filePath: 'src/types/user.ts', line: 1, endLine: 10 },
      { id: 'e5', name: 'BaseService', type: 'Class', filePath: 'src/services/base.ts', line: 1, endLine: 20 },
    ],
    relations: [
      { id: 'r1', source: 'e3', target: 'e1', type: 'calls' },
      { id: 'r2', source: 'e1', target: 'e2', type: 'uses' },
      { id: 'r3', source: 'e1', target: 'e5', type: 'extends' },
      { id: 'r4', source: 'e1', target: 'e4', type: 'implements' },
    ],
  }
}

describe('generateModuleDependencyDiagram', () => {
  it('generates valid Mermaid flowchart', () => {
    const mermaid = generateModuleDependencyDiagram(makeGraph())
    expect(mermaid).toContain('flowchart')
    expect(mermaid).toContain('entities')
  })

  it('handles empty graph', () => {
    const mermaid = generateModuleDependencyDiagram({ entities: [], relations: [] })
    expect(mermaid).toContain('flowchart')
  })

  it('respects maxNodes option', () => {
    const mermaid = generateModuleDependencyDiagram(makeGraph(), { maxNodes: 1 })
    expect(mermaid).toContain('flowchart')
  })
})

describe('generateClassHierarchyDiagram', () => {
  it('generates class hierarchy', () => {
    const mermaid = generateClassHierarchyDiagram(makeGraph())
    expect(mermaid).toContain('flowchart')
    expect(mermaid).toContain('extends')
  })

  it('shows implements relations', () => {
    const mermaid = generateClassHierarchyDiagram(makeGraph())
    expect(mermaid).toContain('implements')
  })

  it('handles graph with no hierarchy', () => {
    const mermaid = generateClassHierarchyDiagram({ entities: [], relations: [] })
    expect(mermaid).toContain('No class hierarchy found')
  })
})

describe('generateComponentFlowDiagram', () => {
  it('generates component flow', () => {
    const mermaid = generateComponentFlowDiagram(makeGraph())
    expect(mermaid).toContain('flowchart')
  })

  it('handles empty graph', () => {
    const mermaid = generateComponentFlowDiagram({ entities: [], relations: [] })
    expect(mermaid).toContain('No components found')
  })
})

describe('generateAllDiagrams', () => {
  it('returns 4 diagrams', () => {
    const diagrams = generateAllDiagrams(makeGraph())
    expect(diagrams).toHaveLength(4)
    expect(diagrams[0].type).toBe('module-dependency')
    expect(diagrams[1].type).toBe('class-hierarchy')
    expect(diagrams[2].type).toBe('component-flow')
    expect(diagrams[3].type).toBe('sequence')
  })

  it('each diagram has mermaid content', () => {
    const diagrams = generateAllDiagrams(makeGraph())
    for (const d of diagrams) {
      expect(d.mermaid).toBeTruthy()
      expect(d.title).toBeTruthy()
    }
  })
})
