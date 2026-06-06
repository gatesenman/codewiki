import { describe, it, expect } from 'vitest'
import { generateRepoMap, generateFocusedRepoMap } from '../repo-map'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UserService', type: 'Class', filePath: 'src/services/user.ts', line: 1, endLine: 50 },
      { id: 'e2', name: 'AuthService', type: 'Class', filePath: 'src/services/auth.ts', line: 1, endLine: 30 },
      { id: 'e3', name: 'UserController', type: 'Class', filePath: 'src/controllers/user.ts', line: 1, endLine: 40 },
    ],
    relations: [
      { id: 'r1', source: 'e3', target: 'e1', type: 'calls' },
      { id: 'r2', source: 'e1', target: 'e2', type: 'uses' },
    ],
  }
}

describe('generateRepoMap', () => {
  it('generates a text map with entities', () => {
    const map = generateRepoMap(makeGraph())
    expect(map).toContain('# Repo Map')
    expect(map).toContain('UserService')
    expect(map).toContain('AuthService')
    expect(map).toContain('UserController')
  })

  it('respects maxChars limit', () => {
    const map = generateRepoMap(makeGraph(), { maxChars: 100 })
    expect(map.length).toBeLessThanOrEqual(200) // some overhead
  })

  it('handles empty graph', () => {
    const map = generateRepoMap({ entities: [], relations: [] })
    expect(map).toContain('empty project')
  })

  it('includes dependency info when includeRelations is true', () => {
    const map = generateRepoMap(makeGraph(), { includeRelations: true })
    expect(map).toContain('depends on')
  })

  it('can focus on specific files', () => {
    const map = generateRepoMap(makeGraph(), { focusFiles: ['src/services/user.ts'] })
    expect(map).toContain('UserService')
    expect(map).not.toContain('UserController')
  })
})

describe('generateFocusedRepoMap', () => {
  it('includes seed files and their neighbors', () => {
    const map = generateFocusedRepoMap(makeGraph(), ['src/services/user.ts'])
    expect(map).toContain('UserService')
    // auth.ts should be included as a 1-hop neighbor
    expect(map).toContain('AuthService')
  })
})
