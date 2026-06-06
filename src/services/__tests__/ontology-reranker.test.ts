import { describe, it, expect } from 'vitest'
import { rerankWithOntology } from '../ontology-reranker'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UserService', type: 'Class', filePath: 'src/services/user.ts', line: 1, endLine: 50 },
      { id: 'e2', name: 'AuthService', type: 'Class', filePath: 'src/services/auth.ts', line: 1, endLine: 30 },
      { id: 'e3', name: 'DatabaseHelper', type: 'Class', filePath: 'src/utils/db.ts', line: 1, endLine: 80 },
      { id: 'e4', name: 'UserController', type: 'Class', filePath: 'src/controllers/user.ts', line: 1, endLine: 40 },
    ],
    relations: [
      { id: 'r1', source: 'e4', target: 'e1', type: 'calls' },
      { id: 'r2', source: 'e1', target: 'e2', type: 'uses' },
      { id: 'r3', source: 'e1', target: 'e3', type: 'dependsOn' },
      { id: 'r4', source: 'e2', target: 'e3', type: 'dependsOn' },
    ],
  }
}

describe('rerankWithOntology', () => {
  it('returns results unchanged when graph is empty', () => {
    const results = [
      { id: '1', score: 0.8, content: 'test', metadata: { filePath: 'a.ts' } },
    ]
    const out = rerankWithOntology(results, 'test', { entities: [], relations: [] })
    expect(out).toHaveLength(1)
    expect(out[0].score).toBe(0.8)
    expect(out[0].originalScore).toBe(0.8)
  })

  it('boosts results containing entities matching the query', () => {
    const graph = makeGraph()
    const results = [
      { id: '1', score: 0.5, content: 'code', metadata: { filePath: 'src/services/user.ts' } },
      { id: '2', score: 0.5, content: 'code', metadata: { filePath: 'src/utils/db.ts' } },
    ]
    const out = rerankWithOntology(results, 'UserService', graph)
    // user.ts has a direct entity match → boosted above db.ts (same original score)
    expect(out[0].metadata.filePath).toBe('src/services/user.ts')
    expect(out[0].score).toBeGreaterThan(out[0].originalScore)
  })

  it('applies proximity boost for N-hop neighbors', () => {
    const graph = makeGraph()
    const results = [
      { id: '1', score: 0.5, content: 'code', metadata: { filePath: 'src/services/auth.ts' } },
      { id: '2', score: 0.5, content: 'code', metadata: { filePath: 'src/controllers/user.ts' } },
    ]
    // Query for UserService — auth.ts is 1-hop away (UserService → AuthService)
    const out = rerankWithOntology(results, 'UserService', graph)
    expect(out[0].score).toBeGreaterThan(0.5)
    expect(out[1].score).toBeGreaterThan(0.5)
  })

  it('handles empty results', () => {
    const out = rerankWithOntology([], 'test', makeGraph())
    expect(out).toHaveLength(0)
  })

  it('preserves original score', () => {
    const results = [
      { id: '1', score: 0.9, content: 'code', metadata: { filePath: 'src/x.ts' } },
    ]
    const out = rerankWithOntology(results, 'nothing', makeGraph())
    expect(out[0].originalScore).toBe(0.9)
  })
})
