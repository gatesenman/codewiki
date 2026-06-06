import { describe, it, expect } from 'vitest'
import { analyzeCodeMap } from '../codemap-analyzer'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UserService', type: 'Class', filePath: 'src/services/user.ts', line: 1, endLine: 50 },
      { id: 'e2', name: 'AuthService', type: 'Class', filePath: 'src/services/auth.ts', line: 1, endLine: 30 },
      { id: 'e3', name: 'UserController', type: 'Class', filePath: 'src/controllers/user.ts', line: 1, endLine: 40 },
      { id: 'e4', name: 'main', type: 'Function', filePath: 'src/index.ts', line: 1, endLine: 10 },
      { id: 'e5', name: 'IUser', type: 'Interface', filePath: 'src/types/user.ts', line: 1, endLine: 8 },
    ],
    relations: [
      { id: 'r1', source: 'e3', target: 'e1', type: 'calls' },
      { id: 'r2', source: 'e1', target: 'e2', type: 'uses' },
      { id: 'r3', source: 'e4', target: 'e1', type: 'dependsOn' },
      { id: 'r4', source: 'e4', target: 'e3', type: 'dependsOn' },
    ],
  }
}

describe('analyzeCodeMap', () => {
  it('produces tree, dependencies, files, and stats', () => {
    const data = analyzeCodeMap(makeGraph())
    expect(data.tree).toBeDefined()
    expect(data.dependencies).toBeDefined()
    expect(data.files).toBeDefined()
    expect(data.stats).toBeDefined()
  })

  it('stats reflect correct entity/file counts', () => {
    const data = analyzeCodeMap(makeGraph())
    expect(data.stats.totalEntities).toBe(5)
    expect(data.stats.totalRelations).toBe(4)
    expect(data.stats.totalFiles).toBe(5) // 5 unique file paths
  })

  it('files have inDegree/outDegree', () => {
    const data = analyzeCodeMap(makeGraph())
    const userService = data.files.find(f => f.path === 'src/services/user.ts')
    expect(userService).toBeDefined()
    // user.ts: inbound from controllers/user.ts and index.ts, outbound to auth.ts
    expect(userService!.inDegree).toBeGreaterThan(0)
  })

  it('generates module-level dependencies', () => {
    const data = analyzeCodeMap(makeGraph(), undefined, 2)
    // There should be cross-module deps between src/controllers and src/services, etc.
    expect(data.dependencies.length).toBeGreaterThan(0)
  })

  it('tree has directory and file nodes', () => {
    const data = analyzeCodeMap(makeGraph())
    const hasDir = data.tree.type === 'directory'
    expect(hasDir).toBe(true)
    // Should have children
    expect(data.tree.children.length).toBeGreaterThan(0)
  })

  it('handles empty graph', () => {
    const data = analyzeCodeMap({ entities: [], relations: [] })
    expect(data.stats.totalEntities).toBe(0)
    expect(data.stats.totalFiles).toBe(0)
    expect(data.dependencies).toHaveLength(0)
  })
})
