/**
 * Graph time-dimension: architecture evolution across snapshots.
 *
 * Compares ontology graphs captured at different points in time (e.g. git
 * commits) to surface how the architecture changed — entities/relations added,
 * removed, or moved, plus simple per-snapshot complexity metrics and trends.
 *
 * Pure (snapshots in → diff/timeline out), no IO.
 */

import type { OntologyEntity, OntologyGraph, OntologyRelation } from '../types'

// ---- Types ---------------------------------------------------------------

export interface GraphSnapshot {
  /** Identifier for this point in time — e.g. a commit SHA or ISO date. */
  ref: string
  /** Optional human label (commit message, tag, date). */
  label?: string
  /** Unix ms timestamp, used for ordering the timeline. */
  timestamp: number
  graph: OntologyGraph
}

export interface EntityChange {
  id: string
  name: string
  type: string
  /** For 'moved', the previous file path. */
  fromFile?: string
  toFile?: string
}

export interface GraphDiff {
  fromRef: string
  toRef: string
  addedEntities: EntityChange[]
  removedEntities: EntityChange[]
  movedEntities: EntityChange[]
  addedRelations: number
  removedRelations: number
  /** Net change in entity count. */
  entityDelta: number
  /** Net change in relation count. */
  relationDelta: number
}

export interface SnapshotMetrics {
  ref: string
  label?: string
  timestamp: number
  entityCount: number
  relationCount: number
  /** Avg out-degree (coupling indicator). */
  avgDegree: number
  /** Entities with no incoming or outgoing edges. */
  isolatedEntities: number
  /** Per entity-type counts. */
  byType: Record<string, number>
}

export interface EvolutionTimeline {
  metrics: SnapshotMetrics[]
  diffs: GraphDiff[]
  /** Overall trend across the whole timeline. */
  trend: {
    entityGrowth: number
    relationGrowth: number
    /** True when coupling (avgDegree) rose meaningfully across the timeline. */
    couplingIncreasing: boolean
  }
}

// ---- Helpers -------------------------------------------------------------

/** Stable identity for an entity across snapshots (id may be regenerated). */
function entityKey(e: OntologyEntity): string {
  return `${e.type}:${e.name}`
}

function relationKey(r: OntologyRelation, byId: Map<string, OntologyEntity>): string {
  const s = byId.get(r.source)
  const t = byId.get(r.target)
  const sk = s ? entityKey(s) : r.source
  const tk = t ? entityKey(t) : r.target
  return `${sk}|${r.type}|${tk}`
}

// ---- Metrics -------------------------------------------------------------

export function snapshotMetrics(snap: GraphSnapshot): SnapshotMetrics {
  const { graph } = snap
  const n = graph.entities.length
  const m = graph.relations.length

  const degree = new Map<string, number>()
  for (const r of graph.relations) {
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1)
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1)
  }
  const isolated = graph.entities.filter(e => !degree.has(e.id)).length

  const byType: Record<string, number> = {}
  for (const e of graph.entities) byType[e.type] = (byType[e.type] ?? 0) + 1

  return {
    ref: snap.ref,
    label: snap.label,
    timestamp: snap.timestamp,
    entityCount: n,
    relationCount: m,
    avgDegree: n ? +(m / n).toFixed(3) : 0,
    isolatedEntities: isolated,
    byType,
  }
}

// ---- Diff ----------------------------------------------------------------

export function diffGraphs(from: GraphSnapshot, to: GraphSnapshot): GraphDiff {
  const fromById = new Map(from.graph.entities.map(e => [e.id, e]))
  const toById = new Map(to.graph.entities.map(e => [e.id, e]))

  const fromByKey = new Map(from.graph.entities.map(e => [entityKey(e), e]))
  const toByKey = new Map(to.graph.entities.map(e => [entityKey(e), e]))

  const addedEntities: EntityChange[] = []
  const removedEntities: EntityChange[] = []
  const movedEntities: EntityChange[] = []

  for (const [key, e] of toByKey) {
    if (!fromByKey.has(key)) {
      addedEntities.push({ id: e.id, name: e.name, type: e.type, toFile: e.filePath })
    } else {
      const prev = fromByKey.get(key)!
      if (prev.filePath !== e.filePath) {
        movedEntities.push({ id: e.id, name: e.name, type: e.type, fromFile: prev.filePath, toFile: e.filePath })
      }
    }
  }
  for (const [key, e] of fromByKey) {
    if (!toByKey.has(key)) {
      removedEntities.push({ id: e.id, name: e.name, type: e.type, fromFile: e.filePath })
    }
  }

  const fromRelKeys = new Set(from.graph.relations.map(r => relationKey(r, fromById)))
  const toRelKeys = new Set(to.graph.relations.map(r => relationKey(r, toById)))
  let addedRelations = 0, removedRelations = 0
  for (const k of toRelKeys) if (!fromRelKeys.has(k)) addedRelations++
  for (const k of fromRelKeys) if (!toRelKeys.has(k)) removedRelations++

  return {
    fromRef: from.ref,
    toRef: to.ref,
    addedEntities,
    removedEntities,
    movedEntities,
    addedRelations,
    removedRelations,
    entityDelta: to.graph.entities.length - from.graph.entities.length,
    relationDelta: to.graph.relations.length - from.graph.relations.length,
  }
}

// ---- Timeline ------------------------------------------------------------

export function buildTimeline(snapshots: GraphSnapshot[]): EvolutionTimeline {
  const ordered = [...snapshots].sort((a, b) => a.timestamp - b.timestamp)
  const metrics = ordered.map(snapshotMetrics)
  const diffs: GraphDiff[] = []
  for (let i = 1; i < ordered.length; i++) {
    diffs.push(diffGraphs(ordered[i - 1], ordered[i]))
  }

  const first = metrics[0]
  const last = metrics[metrics.length - 1]
  const trend = {
    entityGrowth: last && first ? last.entityCount - first.entityCount : 0,
    relationGrowth: last && first ? last.relationCount - first.relationCount : 0,
    couplingIncreasing: !!(last && first && last.avgDegree > first.avgDegree + 0.1),
  }

  return { metrics, diffs, trend }
}
