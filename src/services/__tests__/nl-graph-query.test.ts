import { describe, it, expect } from 'vitest'
import { executeNLQuery } from '../nl-graph-query'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UserService', type: 'Class', filePath: 'src/services/user.ts', line: 1, endLine: 50 },
      { id: 'e2', name: 'AuthService', type: 'Class', filePath: 'src/services/auth.ts', line: 1, endLine: 30 },
      { id: 'e3', name: 'handleLogin', type: 'Function', filePath: 'src/handlers/login.ts', line: 1, endLine: 20 },
      { id: 'e4', name: 'Isolated', type: 'Function', filePath: 'src/utils.ts', line: 1, endLine: 10 },
    ],
    relations: [
      { id: 'r1', source: 'e3', target: 'e1', type: 'calls' },
      { id: 'r2', source: 'e1', target: 'e2', type: 'uses' },
    ],
  }
}

describe('executeNLQuery', () => {
  it('finds callers of an entity', () => {
    const result = executeNLQuery('what calls UserService?', makeGraph())
    expect(result.intent).toBe('find_callers')
    expect(result.entities.map(e => e.name)).toContain('handleLogin')
  })

  it('finds callees', () => {
    const result = executeNLQuery('what does UserService call?', makeGraph())
    expect(result.intent).toBe('find_callees')
    expect(result.entities.map(e => e.name)).toContain('AuthService')
  })

  it('finds entities by type', () => {
    const result = executeNLQuery('show all classes', makeGraph())
    expect(result.intent).toBe('find_by_type')
    expect(result.entities).toHaveLength(2)
  })

  it('finds entities by file', () => {
    const result = executeNLQuery('entities in services/', makeGraph())
    expect(result.intent).toBe('find_by_file')
    expect(result.entities.length).toBeGreaterThanOrEqual(2)
  })

  it('finds isolated entities', () => {
    const result = executeNLQuery('isolated entities', makeGraph())
    expect(result.intent).toBe('find_isolated')
    expect(result.entities.map(e => e.name)).toContain('Isolated')
  })

  it('finds hub entities', () => {
    const result = executeNLQuery('most connected entities', makeGraph())
    expect(result.intent).toBe('find_hub')
    expect(result.entities.length).toBeGreaterThan(0)
  })

  it('finds by name as fallback', () => {
    const result = executeNLQuery('find handleLogin', makeGraph())
    expect(result.entities.map(e => e.name)).toContain('handleLogin')
  })

  it('supports Chinese queries', () => {
    const result = executeNLQuery('谁调用了UserService', makeGraph())
    expect(result.intent).toBe('find_callers')
    expect(result.entities.map(e => e.name)).toContain('handleLogin')
  })
})
