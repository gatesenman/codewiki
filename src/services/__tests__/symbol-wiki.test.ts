import { describe, it, expect } from 'vitest'
import { generateSymbolWiki, generateAllSymbolWikis } from '../symbol-wiki'
import type { OntologyGraph } from '../../types'

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'cls-user', name: 'UserService', type: 'Class', filePath: 'src/services/user.ts', line: 1, endLine: 50, signature: 'class UserService' },
      { id: 'fn-getUser', name: 'getUser', type: 'Function', filePath: 'src/services/user.ts', line: 10, endLine: 20, signature: 'async getUser(id: string): Promise<User>' },
      { id: 'fn-login', name: 'login', type: 'Function', filePath: 'src/auth/login.ts', line: 5, endLine: 30, signature: 'async login(creds: Creds): Promise<void>' },
      { id: 'fn-register', name: 'register', type: 'Function', filePath: 'src/auth/register.ts', line: 1, endLine: 40 },
      { id: 'iface-user', name: 'User', type: 'Interface', filePath: 'src/types/user.ts', line: 1, endLine: 10, signature: 'interface User { id: string; name: string }' },
      { id: 'fn-isolated', name: 'orphan', type: 'Function', filePath: 'src/utils/orphan.ts', line: 1, endLine: 5 },
    ],
    relations: [
      { id: 'r1', source: 'cls-user', target: 'fn-getUser', type: 'contains' },
      { id: 'r2', source: 'fn-login', target: 'fn-getUser', type: 'calls' },
      { id: 'r3', source: 'fn-register', target: 'fn-getUser', type: 'calls' },
      { id: 'r4', source: 'fn-getUser', target: 'iface-user', type: 'uses' },
      { id: 'r5', source: 'fn-login', target: 'cls-user', type: 'imports' },
      { id: 'r6', source: 'cls-user', target: 'iface-user', type: 'implements' },
      // bidirectional: login calls getUser, getUser also calls login (cycle)
      { id: 'r7', source: 'fn-getUser', target: 'fn-login', type: 'calls' },
    ],
  }
}

describe('symbol-wiki', () => {
  const graph = makeGraph()

  describe('generateSymbolWiki', () => {
    it('returns null for unknown entity', () => {
      expect(generateSymbolWiki(graph, 'nonexistent')).toBeNull()
    })

    it('generates a page for UserService class', () => {
      const page = generateSymbolWiki(graph, 'cls-user')!
      expect(page).not.toBeNull()
      expect(page.entity.name).toBe('UserService')
      expect(page.definition.type).toBe('Class')
      expect(page.definition.filePath).toBe('src/services/user.ts')
    })

    it('populates usages for getUser', () => {
      const page = generateSymbolWiki(graph, 'fn-getUser')!
      expect(page.usages.length).toBeGreaterThanOrEqual(2)
      const callerNames = page.usages.map(u => u.entity.name)
      expect(callerNames).toContain('login')
      expect(callerNames).toContain('register')
    })

    it('populates definition context for contained entity', () => {
      const page = generateSymbolWiki(graph, 'fn-getUser')!
      expect(page.definition.context).toContain('UserService')
    })

    it('generates notes about bidirectional dependency', () => {
      const page = generateSymbolWiki(graph, 'fn-getUser')!
      const cycleNote = page.notes.find(n => n.text.includes('Bidirectional'))
      expect(cycleNote).toBeDefined()
      expect(cycleNote!.severity).toBe('warning')
    })

    it('generates dead code warning for orphan entity', () => {
      const page = generateSymbolWiki(graph, 'fn-isolated')!
      const deadNote = page.notes.find(n => n.text.includes('no detected relations'))
      expect(deadNote).toBeDefined()
    })

    it('populates seeAlso entries', () => {
      const page = generateSymbolWiki(graph, 'fn-getUser')!
      expect(page.seeAlso.length).toBeGreaterThan(0)
    })

    it('generates follow-up questions', () => {
      const page = generateSymbolWiki(graph, 'fn-getUser')!
      expect(page.followUpQuestions.length).toBeGreaterThan(0)
      expect(page.followUpQuestions.length).toBeLessThanOrEqual(5)
    })

    it('computes metadata', () => {
      const page = generateSymbolWiki(graph, 'fn-getUser')!
      expect(page.metadata.callerCount).toBeGreaterThanOrEqual(2)
      expect(page.metadata.totalRelations).toBeGreaterThan(0)
      expect(page.metadata.couplingScore).toBeGreaterThan(0)
      expect(page.metadata.couplingScore).toBeLessThanOrEqual(1)
    })

    it('handles class with implementors note', () => {
      const page = generateSymbolWiki(graph, 'iface-user')!
      const implNote = page.notes.find(n => n.text.includes('Extended/implemented'))
      expect(implNote).toBeDefined()
    })
  })

  describe('generateAllSymbolWikis', () => {
    it('generates pages for all entities', () => {
      const all = generateAllSymbolWikis(graph)
      expect(all.size).toBe(graph.entities.length)
    })
  })
})
