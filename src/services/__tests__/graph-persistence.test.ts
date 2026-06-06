import { describe, it, expect } from 'vitest'
import { mergeGraphs, removeFileEntities, graphStats } from '../graph-persistence'
import type { OntologyGraph } from '../../types'

describe('mergeGraphs', () => {
  it('combines entities from both graphs', () => {
    const base: OntologyGraph = {
      entities: [{ id: 'e1', name: 'A', type: 'Class', filePath: 'a.ts', line: 1, endLine: 10 }],
      relations: [],
    }
    const incoming: OntologyGraph = {
      entities: [{ id: 'e2', name: 'B', type: 'Class', filePath: 'b.ts', line: 1, endLine: 10 }],
      relations: [],
    }
    const merged = mergeGraphs(base, incoming)
    expect(merged.entities).toHaveLength(2)
  })

  it('deduplicates by entity id', () => {
    const base: OntologyGraph = {
      entities: [{ id: 'e1', name: 'A', type: 'Class', filePath: 'a.ts', line: 1, endLine: 10 }],
      relations: [],
    }
    const merged = mergeGraphs(base, base)
    expect(merged.entities).toHaveLength(1)
  })
})

describe('removeFileEntities', () => {
  it('removes entities from specified files', () => {
    const graph: OntologyGraph = {
      entities: [
        { id: 'e1', name: 'A', type: 'Class', filePath: 'a.ts', line: 1, endLine: 10 },
        { id: 'e2', name: 'B', type: 'Class', filePath: 'b.ts', line: 1, endLine: 10 },
      ],
      relations: [{ id: 'r1', source: 'e1', target: 'e2', type: 'calls' }],
    }
    const cleaned = removeFileEntities(graph, new Set(['a.ts']))
    expect(cleaned.entities).toHaveLength(1)
    expect(cleaned.entities[0].name).toBe('B')
    // r1 should also be removed since e1 is gone
    expect(cleaned.relations).toHaveLength(0)
  })
})

describe('graphStats', () => {
  it('computes correct stats', () => {
    const graph: OntologyGraph = {
      entities: [
        { id: 'e1', name: 'A', type: 'Class', filePath: 'a.ts', line: 1, endLine: 10 },
        { id: 'e2', name: 'B', type: 'Function', filePath: 'b.ts', line: 1, endLine: 10 },
      ],
      relations: [{ id: 'r1', source: 'e1', target: 'e2', type: 'calls' }],
    }
    const stats = graphStats(graph)
    expect(stats.entities).toBe(2)
    expect(stats.relations).toBe(1)
    expect(stats.files).toBe(2)
    expect(stats.entityTypes.Class).toBe(1)
    expect(stats.entityTypes.Function).toBe(1)
    expect(stats.relationTypes.calls).toBe(1)
  })
})
