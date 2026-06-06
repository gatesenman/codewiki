import { describe, it, expect } from 'vitest'
import type { OntologyGraph } from '../../types'

// pattern-detector doesn't use a default export — import the named exports
import type { PatternReport } from '../pattern-detector'

// Dynamic import to handle the module
const { detectPatterns } = await import('../pattern-detector')

function emptyGraph(): OntologyGraph {
  return { entities: [], relations: [] }
}

function graphWithSingleton(): OntologyGraph {
  return {
    entities: [
      { id: 'c1', name: 'Database', type: 'Class', filePath: 'db.ts', line: 1, endLine: 30 },
      { id: 'm1', name: 'getInstance', type: 'Method', filePath: 'db.ts', line: 5, endLine: 10 },
      { id: 'm2', name: 'instance', type: 'Variable', filePath: 'db.ts', line: 2, endLine: 2 },
    ],
    relations: [
      { id: 'r1', source: 'c1', target: 'm1', type: 'contains' },
      { id: 'r2', source: 'c1', target: 'm2', type: 'contains' },
    ],
  }
}

function graphWithFactory(): OntologyGraph {
  return {
    entities: [
      { id: 'c1', name: 'WidgetFactory', type: 'Class', filePath: 'factory.ts', line: 1, endLine: 30 },
      { id: 'm1', name: 'create', type: 'Method', filePath: 'factory.ts', line: 5, endLine: 10 },
      { id: 'm2', name: 'createWidget', type: 'Method', filePath: 'factory.ts', line: 12, endLine: 20 },
    ],
    relations: [
      { id: 'r1', source: 'c1', target: 'm1', type: 'contains' },
      { id: 'r2', source: 'c1', target: 'm2', type: 'contains' },
    ],
  }
}

function graphWithGodObject(): OntologyGraph {
  const entities: OntologyGraph['entities'] = [
    { id: 'god', name: 'MegaManager', type: 'Class', filePath: 'mega.ts', line: 1, endLine: 500 },
  ]
  const relations: OntologyGraph['relations'] = []
  for (let i = 0; i < 25; i++) {
    entities.push({ id: `m${i}`, name: `doThing${i}`, type: 'Method', filePath: 'mega.ts', line: i + 2, endLine: i + 3 })
    relations.push({ id: `rc${i}`, source: 'god', target: `m${i}`, type: 'contains' })
  }
  for (let i = 0; i < 25; i++) {
    entities.push({ id: `dep${i}`, name: `Service${i}`, type: 'Class', filePath: `svc${i}.ts`, line: 1, endLine: 5 })
    relations.push({ id: `rd${i}`, source: 'god', target: `dep${i}`, type: 'imports' })
  }
  return { entities, relations }
}

describe('detectPatterns', () => {
  it('returns empty report for empty graph', () => {
    const report: PatternReport = detectPatterns(emptyGraph())
    expect(report.entities).toHaveLength(0)
  })

  it('detects singleton pattern', () => {
    const report = detectPatterns(graphWithSingleton())
    const singletons = report.entities.filter(e => e.tags.some(t => t.kind === 'Singleton'))
    expect(singletons.length).toBeGreaterThanOrEqual(1)
  })

  it('detects factory pattern', () => {
    const report = detectPatterns(graphWithFactory())
    const factories = report.entities.filter(e => e.tags.some(t => t.kind === 'Factory'))
    expect(factories.length).toBeGreaterThanOrEqual(1)
  })

  it('detects god objects', () => {
    const report = detectPatterns(graphWithGodObject())
    const gods = report.entities.filter(e => e.tags.some(t => t.kind === 'GodObject'))
    expect(gods.length).toBeGreaterThanOrEqual(1)
    const antiTags = gods[0].tags.filter(t => t.anti)
    expect(antiTags.length).toBeGreaterThan(0)
  })

  it('counts are accurate', () => {
    const report = detectPatterns(graphWithGodObject())
    const totalFromCounts = Object.values(report.counts).reduce((a, b) => a + b, 0)
    const totalFromEntities = report.entities.reduce((sum, e) => sum + e.tags.length, 0)
    expect(totalFromCounts).toBe(totalFromEntities)
  })
})
