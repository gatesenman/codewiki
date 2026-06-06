/**
 * Design pattern / anti-pattern detection (CodeFlow-inspired).
 *
 * Heuristic, ontology-driven recognition of common patterns (Singleton, Factory,
 * Observer, Builder, Strategy, Repository) and anti-patterns (God Object, high
 * coupling). Pure (graph in → per-entity tags out); used for explainability —
 * surfaced as entity tags and folded into the health summary.
 */

import type { OntologyEntity, OntologyGraph } from './../types'

export type PatternKind =
  | 'Singleton' | 'Factory' | 'Observer' | 'Builder' | 'Strategy' | 'Repository'
  | 'GodObject' | 'HighCoupling'

export interface PatternTag {
  kind: PatternKind
  /** True for anti-patterns (shown as warnings). */
  anti: boolean
  /** Short reason the heuristic fired. */
  reason: string
}

export interface EntityPatterns {
  entityId: string
  name: string
  type: string
  file: string
  tags: PatternTag[]
}

export interface PatternReport {
  entities: EntityPatterns[]
  /** PatternKind -> count of entities tagged with it. */
  counts: Record<string, number>
}

const DEP_RELATIONS = new Set(['imports', 'dependsOn', 'calls', 'uses', 'extends', 'implements'])
const GOD_OBJECT_FANOUT = 20
const GOD_OBJECT_MEMBERS = 20
const HIGH_COUPLING_DEGREE = 12

function memberNames(graph: OntologyGraph, classId: string, byId: Map<string, OntologyEntity>): string[] {
  const names: string[] = []
  for (const r of graph.relations) {
    if (r.type === 'contains' && r.source === classId) {
      const m = byId.get(r.target)
      if (m) names.push(m.name)
    }
  }
  return names
}

export function detectPatterns(graph: OntologyGraph): PatternReport {
  const byId = new Map<string, OntologyEntity>()
  for (const e of graph.entities) byId.set(e.id, e)

  // Coupling metrics.
  const fanIn = new Map<string, number>()
  const fanOut = new Map<string, number>()
  const memberCount = new Map<string, number>()
  for (const r of graph.relations) {
    if (r.type === 'contains') { memberCount.set(r.source, (memberCount.get(r.source) || 0) + 1); continue }
    if (!DEP_RELATIONS.has(r.type)) continue
    fanOut.set(r.source, (fanOut.get(r.source) || 0) + 1)
    fanIn.set(r.target, (fanIn.get(r.target) || 0) + 1)
  }

  const result: EntityPatterns[] = []
  const counts: Record<string, number> = {}
  const bump = (k: PatternKind) => { counts[k] = (counts[k] || 0) + 1 }

  for (const e of graph.entities) {
    if (e.type === 'File' || e.type === 'Module' || e.type === 'Package') continue
    const tags: PatternTag[] = []
    const name = e.name
    const members = (e.type === 'Class' || e.type === 'Interface') ? memberNames(graph, e.id, byId) : []
    const memberLower = members.map(m => m.toLowerCase())
    const sig = (e.signature || '').toLowerCase()

    // ---- Design patterns ----
    if (e.type === 'Class' || e.type === 'Function') {
      if (memberLower.includes('getinstance') || /\bsingleton\b/i.test(name) ||
          (memberLower.includes('instance') && /private\s+constructor/.test(sig))) {
        tags.push({ kind: 'Singleton', anti: false, reason: 'getInstance/instance accessor' })
      }
      if (/factory$/i.test(name) || memberLower.some(m => /^create[a-z]/i.test(m) || /^make[a-z]/i.test(m) || m === 'build')) {
        tags.push({ kind: 'Factory', anti: false, reason: 'create/make/build factory method' })
      }
      if (memberLower.some(m => ['subscribe', 'unsubscribe', 'notify', 'emit', 'addlistener', 'removelistener', 'on', 'off', 'publish'].includes(m))) {
        tags.push({ kind: 'Observer', anti: false, reason: 'subscribe/notify/emit methods' })
      }
      if (/builder$/i.test(name) || (memberLower.includes('build') && memberLower.length > 3)) {
        tags.push({ kind: 'Builder', anti: false, reason: 'Builder naming + build()' })
      }
      if (/strategy$/i.test(name)) {
        tags.push({ kind: 'Strategy', anti: false, reason: 'Strategy naming' })
      }
      if (/(repository|repo|dao)$/i.test(name)) {
        tags.push({ kind: 'Repository', anti: false, reason: 'Repository/DAO naming' })
      }
    }

    // ---- Anti-patterns ----
    const fo = fanOut.get(e.id) || 0
    const fi = fanIn.get(e.id) || 0
    const mem = memberCount.get(e.id) || 0
    if (fo >= GOD_OBJECT_FANOUT || mem >= GOD_OBJECT_MEMBERS) {
      tags.push({ kind: 'GodObject', anti: true, reason: `fan-out ${fo}, members ${mem}` })
    } else if (fi + fo >= HIGH_COUPLING_DEGREE) {
      tags.push({ kind: 'HighCoupling', anti: true, reason: `degree ${fi + fo} (in ${fi}, out ${fo})` })
    }

    if (tags.length) {
      for (const tg of tags) bump(tg.kind)
      result.push({ entityId: e.id, name: e.name, type: e.type, file: e.filePath, tags })
    }
  }

  return { entities: result, counts }
}

/** Convenience: entityId -> tags, for quick lookup in detail panels. */
export function patternsByEntity(report: PatternReport): Map<string, PatternTag[]> {
  const m = new Map<string, PatternTag[]>()
  for (const e of report.entities) m.set(e.entityId, e.tags)
  return m
}
