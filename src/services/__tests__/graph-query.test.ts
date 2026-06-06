import { describe, it, expect } from 'vitest'
import { parseQuery, executeQuery } from '../graph-query'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UserService', type: 'Class', filePath: 'src/user.ts', line: 1, endLine: 50 },
      { id: 'e2', name: 'AuthService', type: 'Class', filePath: 'src/auth.ts', line: 1, endLine: 30 },
      { id: 'e3', name: 'login', type: 'Function', filePath: 'src/auth.ts', line: 32, endLine: 40 },
      { id: 'e4', name: 'getUser', type: 'Method', filePath: 'src/user.ts', line: 10, endLine: 20 },
      { id: 'e5', name: 'IUser', type: 'Interface', filePath: 'src/types.ts', line: 1, endLine: 10 },
    ],
    relations: [
      { id: 'r1', source: 'e3', target: 'e4', type: 'calls' },
      { id: 'r2', source: 'e2', target: 'e1', type: 'imports' },
      { id: 'r3', source: 'e1', target: 'e5', type: 'implements' },
      { id: 'r4', source: 'e1', target: 'e4', type: 'contains' },
      { id: 'r5', source: 'e3', target: 'e2', type: 'uses' },
    ],
  }
}

describe('parseQuery', () => {
  it('parses "who calls X" as callers', () => {
    const intent = parseQuery('who calls getUser')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('callers')
    expect(intent!.target).toBe('getUser')
  })

  it('parses "callers of X"', () => {
    const intent = parseQuery('callers of login')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('callers')
    expect(intent!.target).toBe('login')
  })

  it('parses "what does X call" as callees', () => {
    const intent = parseQuery('what does login call')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('callees')
    expect(intent!.target).toBe('login')
  })

  it('parses "impact of X"', () => {
    const intent = parseQuery('impact of UserService')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('impact')
    expect(intent!.target).toBe('UserService')
  })

  it('parses "dependencies of X"', () => {
    const intent = parseQuery('dependencies of AuthService')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('dependencies')
    expect(intent!.target).toBe('AuthService')
  })

  it('parses "path from X to Y"', () => {
    const intent = parseQuery('path from login to IUser')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('path')
    expect(intent!.target).toBe('login')
    expect(intent!.target2).toBe('IUser')
  })

  it('parses "find all classes" as find', () => {
    const intent = parseQuery('find all classes')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('find')
    expect(intent!.entityType).toBe('Class')
  })

  it('parses Chinese queries', () => {
    const intent = parseQuery('谁调用了getUser')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('callers')
    expect(intent!.target).toBe('getUser')
  })

  it('parses Chinese impact queries', () => {
    const intent = parseQuery('修改UserService的影响')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('impact')
    expect(intent!.target).toBe('UserService')
  })

  it('returns null for unrecognized queries', () => {
    expect(parseQuery('')).toBeNull()
    expect(parseQuery('hello world')).toBeNull()
  })

  it('parses "references of X"', () => {
    const intent = parseQuery('references of getUser')
    expect(intent).not.toBeNull()
    expect(intent!.op).toBe('references')
  })
})

describe('executeQuery', () => {
  const graph = makeGraph()

  it('finds callers of getUser', () => {
    const result = executeQuery(graph, { op: 'callers', target: 'getUser' })
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].name).toBe('login')
    expect(result.relations).toHaveLength(1)
  })

  it('finds callees of login', () => {
    const result = executeQuery(graph, { op: 'callees', target: 'login' })
    const names = result.entities.map(e => e.name)
    expect(names).toContain('getUser')
  })

  it('finds references of getUser', () => {
    const result = executeQuery(graph, { op: 'references', target: 'getUser' })
    expect(result.entities.length).toBeGreaterThan(0)
  })

  it('computes impact of UserService', () => {
    const result = executeQuery(graph, { op: 'impact', target: 'UserService' })
    expect(result.entities.length).toBeGreaterThan(0)
    const names = result.entities.map(e => e.name)
    expect(names).toContain('AuthService')
  })

  it('finds dependencies of AuthService', () => {
    const result = executeQuery(graph, { op: 'dependencies', target: 'AuthService' })
    const names = result.entities.map(e => e.name)
    expect(names).toContain('UserService')
  })

  it('finds all classes', () => {
    const result = executeQuery(graph, { op: 'find', target: '*', entityType: 'Class' })
    expect(result.entities).toHaveLength(2)
    const names = result.entities.map(e => e.name)
    expect(names).toContain('UserService')
    expect(names).toContain('AuthService')
  })

  it('finds neighbors of login', () => {
    const result = executeQuery(graph, { op: 'neighbors', target: 'login' })
    expect(result.entities.length).toBeGreaterThan(0)
  })

  it('returns empty for non-existent entity', () => {
    const result = executeQuery(graph, { op: 'callers', target: 'nonExistent' })
    expect(result.entities).toHaveLength(0)
  })
})
