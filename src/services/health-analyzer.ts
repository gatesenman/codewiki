/**
 * Codebase health analyzer (CodeFlow-inspired, ontology-driven).
 *
 * Computes an explainable A–F health score from the ontology graph plus the
 * structural signals that feed it: circular dependencies, coupling hotspots /
 * God Objects, dead code, and isolated entities. Pure (graph in → report out),
 * no IO, no LLM — safe to run in CLI, Electron renderer, or MCP.
 */

import type { OntologyEntity, OntologyGraph } from '../types'

// ---- Types ---------------------------------------------------------------

/** A strongly-connected component of files that depend on each other. */
export interface DependencyCycle {
  /** File paths participating in the cycle (length >= 2, or 1 for self-import). */
  files: string[]
  /** Number of cross-file dependency edges inside the cycle. */
  edges: number
}

export interface DeadCodeItem {
  name: string
  type: string
  file: string
  line: number
  category: 'orphan' | 'exported-unused'
}

export interface CouplingHotspot {
  id: string
  name: string
  type: string
  file: string
  line: number
  /** Incoming dependency edges (how many depend on this). */
  fanIn: number
  /** Outgoing dependency edges (how many this depends on). */
  fanOut: number
  /** fanIn + fanOut. */
  degree: number
  /** True when this looks like a God Object (very high fan-out or member count). */
  godObject: boolean
}

export interface HealthComponent {
  /** Stable key, e.g. 'circularDeps'. */
  key: string
  /** 0–100 sub-score (higher is healthier). */
  score: number
  /** Weight applied to the overall score. */
  weight: number
  /** Raw measured value for display (e.g. "3 cycles"). */
  detail: string
}

export interface HealthReport {
  /** 0–100 overall, weighted. */
  score: number
  /** A–F letter grade derived from score. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  components: HealthComponent[]
  cycles: DependencyCycle[]
  deadCode: DeadCodeItem[]
  hotspots: CouplingHotspot[]
  metrics: {
    entityCount: number
    relationCount: number
    fileCount: number
    avgDegree: number
    isolatedEntities: number
    deadCodeRatio: number
    circularDepCount: number
  }
}

// ---- Constants -----------------------------------------------------------

/** Relation types that represent a real dependency between entities. */
const DEP_RELATIONS = new Set(['imports', 'dependsOn', 'calls', 'uses', 'extends', 'implements'])

/** Fan-out above this flags a likely God Object. */
const GOD_OBJECT_FANOUT = 20
/** Contained-member count above this also flags a God Object (large class). */
const GOD_OBJECT_MEMBERS = 20
/** degree (fanIn+fanOut) at/above this is a coupling hotspot. */
const HOTSPOT_DEGREE = 12

// ---- Circular dependencies (Tarjan SCC on the file graph) ----------------

/**
 * Detect circular dependencies at the file level. Entity-level edges are
 * collapsed to their containing files; self-edges (a file importing itself via
 * its own entities) are ignored unless they are genuine file→file self loops.
 */
export function detectCircularDependencies(graph: OntologyGraph): DependencyCycle[] {
  const byId = new Map<string, OntologyEntity>()
  for (const e of graph.entities) byId.set(e.id, e)

  // Build file-level adjacency from dependency relations that cross files.
  const adj = new Map<string, Set<string>>()
  const edgeCount = new Map<string, number>() // "from|to" -> count
  const ensure = (f: string) => { if (!adj.has(f)) adj.set(f, new Set()) }

  for (const r of graph.relations) {
    if (!DEP_RELATIONS.has(r.type)) continue
    const s = byId.get(r.source)
    const t = byId.get(r.target)
    if (!s || !t) continue
    if (!s.filePath || !t.filePath) continue
    if (s.filePath === t.filePath) continue
    ensure(s.filePath); ensure(t.filePath)
    adj.get(s.filePath)!.add(t.filePath)
    const k = `${s.filePath}|${t.filePath}`
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1)
  }

  // Tarjan's strongly-connected-components.
  let index = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const sccs: string[][] = []

  const nodes = Array.from(adj.keys())
  // Iterative Tarjan to avoid stack overflow on large graphs.
  for (const start of nodes) {
    if (idx.has(start)) continue
    const work: Array<{ v: string; iter: Iterator<string> }> = [
      { v: start, iter: (adj.get(start) || new Set()).values() },
    ]
    idx.set(start, index); low.set(start, index); index++
    stack.push(start); onStack.add(start)

    while (work.length) {
      const top = work[work.length - 1]
      const next = top.iter.next()
      if (!next.done) {
        const w = next.value
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index++
          stack.push(w); onStack.add(w)
          work.push({ v: w, iter: (adj.get(w) || new Set()).values() })
        } else if (onStack.has(w)) {
          low.set(top.v, Math.min(low.get(top.v)!, idx.get(w)!))
        }
      } else {
        if (low.get(top.v) === idx.get(top.v)) {
          const comp: string[] = []
          let w: string
          do {
            w = stack.pop()!
            onStack.delete(w)
            comp.push(w)
          } while (w !== top.v)
          if (comp.length > 1) sccs.push(comp)
        }
        work.pop()
        if (work.length) {
          const parent = work[work.length - 1].v
          low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!))
        }
      }
    }
  }

  const cycles: DependencyCycle[] = sccs.map(files => {
    let edges = 0
    for (const a of files) {
      for (const b of files) {
        if (a === b) continue
        edges += edgeCount.get(`${a}|${b}`) || 0
      }
    }
    return { files: files.sort(), edges }
  })
  // Largest / most entangled cycles first.
  cycles.sort((a, b) => b.files.length - a.files.length || b.edges - a.edges)
  return cycles
}

// ---- Dead code -----------------------------------------------------------

export function detectDeadCode(graph: OntologyGraph): DeadCodeItem[] {
  const dead: DeadCodeItem[] = []
  for (const entity of graph.entities) {
    if (entity.type === 'File' || entity.type === 'Module' || entity.type === 'Package') continue

    const incoming = graph.relations.filter(r => r.target === entity.id && r.type !== 'contains')
    const containsOthers = graph.relations.some(r => r.source === entity.id && r.type === 'contains')
    if (containsOthers && entity.type === 'Class') continue
    if (incoming.length > 0) continue

    const isTest = /test|spec|__mocks__/i.test(entity.filePath) || /test/i.test(entity.name)
    const isEntry = entity.name === 'main' || entity.name === 'default' ||
      /(^|\/)(index|app|server|main)\./i.test(entity.filePath)
    if (isTest || isEntry) continue

    const isExported = entity.signature?.startsWith('export') || false
    dead.push({
      name: entity.name,
      type: entity.type,
      file: entity.filePath,
      line: entity.line,
      category: isExported ? 'exported-unused' : 'orphan',
    })
  }
  return dead
}

// ---- Coupling hotspots / God Objects -------------------------------------

export function detectHotspots(graph: OntologyGraph): CouplingHotspot[] {
  const byId = new Map<string, OntologyEntity>()
  for (const e of graph.entities) byId.set(e.id, e)

  const fanIn = new Map<string, number>()
  const fanOut = new Map<string, number>()
  const members = new Map<string, number>()
  for (const r of graph.relations) {
    if (r.type === 'contains') {
      members.set(r.source, (members.get(r.source) || 0) + 1)
      continue
    }
    if (!DEP_RELATIONS.has(r.type)) continue
    fanOut.set(r.source, (fanOut.get(r.source) || 0) + 1)
    fanIn.set(r.target, (fanIn.get(r.target) || 0) + 1)
  }

  const hotspots: CouplingHotspot[] = []
  for (const e of graph.entities) {
    if (e.type === 'File' || e.type === 'Module' || e.type === 'Package') continue
    const fi = fanIn.get(e.id) || 0
    const fo = fanOut.get(e.id) || 0
    const mem = members.get(e.id) || 0
    const degree = fi + fo
    const godObject = fo >= GOD_OBJECT_FANOUT || mem >= GOD_OBJECT_MEMBERS
    if (degree >= HOTSPOT_DEGREE || godObject) {
      hotspots.push({
        id: e.id, name: e.name, type: e.type, file: e.filePath, line: e.line,
        fanIn: fi, fanOut: fo, degree, godObject,
      })
    }
  }
  hotspots.sort((a, b) => b.degree - a.degree)
  return hotspots
}

// ---- Overall health ------------------------------------------------------

function gradeFor(score: number): HealthReport['grade'] {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

/** Linearly map a ratio (0..cap) to a 0..100 health sub-score (0 ratio = 100). */
function ratioScore(ratio: number, cap: number): number {
  const clamped = Math.max(0, Math.min(cap, ratio))
  return Math.round(100 * (1 - clamped / cap))
}

export interface HealthInput {
  /** Optional external security finding count to fold into the score. */
  securityFindings?: number
}

export function analyzeHealth(graph: OntologyGraph, input: HealthInput = {}): HealthReport {
  const codeEntities = graph.entities.filter(
    e => e.type !== 'File' && e.type !== 'Module' && e.type !== 'Package',
  )
  const fileSet = new Set(graph.entities.map(e => e.filePath).filter(Boolean))

  const cycles = detectCircularDependencies(graph)
  const deadCode = detectDeadCode(graph)
  const hotspots = detectHotspots(graph)

  // Average out-degree over code entities (coupling indicator).
  const depRel = graph.relations.filter(r => DEP_RELATIONS.has(r.type))
  const avgDegree = codeEntities.length ? depRel.length / codeEntities.length : 0

  // Isolated entities: no dependency edge in or out.
  const connected = new Set<string>()
  for (const r of depRel) { connected.add(r.source); connected.add(r.target) }
  const isolated = codeEntities.filter(e => !connected.has(e.id)).length

  const deadRatio = codeEntities.length ? deadCode.length / codeEntities.length : 0
  const cycleRatio = fileSet.size ? cycles.reduce((n, c) => n + c.files.length, 0) / fileSet.size : 0
  const godObjects = hotspots.filter(h => h.godObject).length
  const godRatio = codeEntities.length ? godObjects / codeEntities.length : 0
  const secFindings = input.securityFindings ?? 0
  const secRatio = fileSet.size ? secFindings / fileSet.size : 0

  const components: HealthComponent[] = [
    {
      key: 'circularDeps', weight: 0.3,
      score: ratioScore(cycleRatio, 0.3),
      detail: `${cycles.length}`,
    },
    {
      key: 'deadCode', weight: 0.25,
      score: ratioScore(deadRatio, 0.4),
      detail: `${deadCode.length} (${Math.round(deadRatio * 100)}%)`,
    },
    {
      key: 'coupling', weight: 0.2,
      // avgDegree ~2 is healthy; 8+ is poor.
      score: ratioScore(Math.max(0, avgDegree - 2), 8),
      detail: avgDegree.toFixed(2),
    },
    {
      key: 'godObjects', weight: 0.15,
      score: ratioScore(godRatio, 0.1),
      detail: `${godObjects}`,
    },
    {
      key: 'security', weight: 0.1,
      score: ratioScore(secRatio, 0.5),
      detail: `${secFindings}`,
    },
  ]

  const totalWeight = components.reduce((s, c) => s + c.weight, 0)
  const score = Math.round(
    components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight,
  )

  return {
    score,
    grade: gradeFor(score),
    components,
    cycles,
    deadCode,
    hotspots,
    metrics: {
      entityCount: graph.entities.length,
      relationCount: graph.relations.length,
      fileCount: fileSet.size,
      avgDegree: Number(avgDegree.toFixed(2)),
      isolatedEntities: isolated,
      deadCodeRatio: Number(deadRatio.toFixed(3)),
      circularDepCount: cycles.length,
    },
  }
}
