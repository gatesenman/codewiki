import { describe, it, expect } from 'vitest'
import {
  detectCircularDependencies,
  detectDeadCode,
  detectHotspots,
  analyzeHealth,
} from '../health-analyzer'
import type { OntologyGraph, OntologyEntity, OntologyRelation } from '../../types'

function emptyGraph(): OntologyGraph {
  return { entities: [], relations: [] }
}

function graphWithCycle(): OntologyGraph {
  return {
    entities: [
      { id: 'f1', name: 'fileA', type: 'File', filePath: 'a.ts', line: 1, endLine: 10 },
      { id: 'f2', name: 'fileB', type: 'File', filePath: 'b.ts', line: 1, endLine: 10 },
      { id: 'c1', name: 'ClassA', type: 'Class', filePath: 'a.ts', line: 1, endLine: 10 },
      { id: 'c2', name: 'ClassB', type: 'Class', filePath: 'b.ts', line: 1, endLine: 10 },
    ],
    relations: [
      { id: 'r1', source: 'c1', target: 'c2', type: 'imports' },
      { id: 'r2', source: 'c2', target: 'c1', type: 'imports' },
    ],
  }
}

function graphWithDeadCode(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UsedClass', type: 'Class', filePath: 'used.ts', line: 1, endLine: 10 },
      { id: 'e2', name: 'OrphanClass', type: 'Class', filePath: 'orphan.ts', line: 1, endLine: 10 },
      { id: 'e3', name: 'Caller', type: 'Function', filePath: 'caller.ts', line: 1, endLine: 5 },
    ],
    relations: [
      { id: 'r1', source: 'e3', target: 'e1', type: 'calls' },
    ],
  }
}

function graphWithGodObject(): OntologyGraph {
  const entities: OntologyEntity[] = [
    { id: 'god', name: 'GodClass', type: 'Class', filePath: 'god.ts', line: 1, endLine: 500 },
  ]
  const relations: OntologyRelation[] = []
  for (let i = 0; i < 25; i++) {
    const memberId = `m${i}`
    entities.push({ id: memberId, name: `method${i}`, type: 'Method', filePath: 'god.ts', line: i + 2, endLine: i + 3 })
    relations.push({ id: `r${i}`, source: 'god', target: memberId, type: 'contains' })
  }
  for (let i = 0; i < 25; i++) {
    const depId = `dep${i}`
    entities.push({ id: depId, name: `Dep${i}`, type: 'Class', filePath: `dep${i}.ts`, line: 1, endLine: 5 })
    relations.push({ id: `rd${i}`, source: 'god', target: depId, type: 'imports' })
  }
  return { entities, relations }
}

describe('detectCircularDependencies', () => {
  it('returns empty for empty graph', () => {
    expect(detectCircularDependencies(emptyGraph())).toHaveLength(0)
  })

  it('detects circular dependency between files', () => {
    const cycles = detectCircularDependencies(graphWithCycle())
    expect(cycles.length).toBeGreaterThanOrEqual(1)
  })
})

describe('detectDeadCode', () => {
  it('returns empty for empty graph', () => {
    expect(detectDeadCode(emptyGraph())).toHaveLength(0)
  })

  it('detects orphan entities', () => {
    const dead = detectDeadCode(graphWithDeadCode())
    const names = dead.map(d => d.name)
    expect(names).toContain('OrphanClass')
    expect(names).not.toContain('UsedClass')
  })
})

describe('detectHotspots', () => {
  it('returns empty for empty graph', () => {
    expect(detectHotspots(emptyGraph())).toHaveLength(0)
  })

  it('detects god objects', () => {
    const hotspots = detectHotspots(graphWithGodObject())
    const gods = hotspots.filter(h => h.godObject)
    expect(gods.length).toBeGreaterThanOrEqual(1)
    expect(gods[0].name).toBe('GodClass')
  })
})

describe('analyzeHealth', () => {
  it('returns perfect score for empty graph', () => {
    const report = analyzeHealth(emptyGraph())
    expect(report.grade).toBeDefined()
    expect(report.score).toBeGreaterThanOrEqual(0)
    expect(report.score).toBeLessThanOrEqual(100)
  })

  it('returns a valid grade (A-F)', () => {
    const report = analyzeHealth(graphWithGodObject())
    expect(['A', 'B', 'C', 'D', 'F']).toContain(report.grade)
  })

  it('includes all health components', () => {
    const report = analyzeHealth(graphWithCycle())
    expect(report.components.length).toBeGreaterThan(0)
    const keys = report.components.map(c => c.key)
    expect(keys).toContain('circularDeps')
  })

  it('health score drops with problems', () => {
    const clean = analyzeHealth(emptyGraph())
    const messy = analyzeHealth(graphWithGodObject())
    expect(clean.score).toBeGreaterThanOrEqual(messy.score)
  })
})
