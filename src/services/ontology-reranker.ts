/**
 * Ontology-aware search reranker.
 *
 * Takes a list of vector/keyword search results and re-scores them using
 * the ontology graph context:
 *   1. **Entity match boost** — if a result file contains an entity whose
 *      name matches the query, it gets a direct boost.
 *   2. **Graph proximity boost** — results containing entities reachable
 *      within N hops of a matched entity receive a decaying boost.
 *   3. **Coupling penalty** — files with very high coupling (God objects)
 *      get a slight penalty to favor more focused results.
 *   4. **Freshness signal** — if the file was recently changed (git churn),
 *      a small bonus is applied.
 *
 * Pure function — graph + results in → reranked results out.
 */

import type { OntologyGraph, OntologyEntity } from '../types'

export interface RerankOptions {
  /** Weight for direct entity-name match boost. Default 0.3 */
  entityMatchWeight?: number
  /** Weight for graph proximity (N-hop neighbors). Default 0.2 */
  proximityWeight?: number
  /** Max hops for proximity boost. Default 2 */
  maxHops?: number
  /** Coupling penalty weight. Default 0.05 */
  couplingPenaltyWeight?: number
}

export interface RankedResult {
  id: string
  score: number
  originalScore: number
  content: string
  metadata: Record<string, string>
  boostReason?: string
}

const CROSS_FILE_TYPES = new Set(['imports', 'dependsOn', 'calls', 'uses', 'extends', 'implements'])

/**
 * Rerank search results using ontology graph context.
 */
export function rerankWithOntology(
  results: Array<{ id: string; score: number; content: string; metadata: Record<string, string> }>,
  query: string,
  graph: OntologyGraph,
  options: RerankOptions = {},
): RankedResult[] {
  const {
    entityMatchWeight = 0.3,
    proximityWeight = 0.2,
    maxHops = 2,
    couplingPenaltyWeight = 0.05,
  } = options

  if (!graph || graph.entities.length === 0 || results.length === 0) {
    return results.map(r => ({ ...r, originalScore: r.score }))
  }

  // Index entities by file path and by id
  const entitiesByFile = new Map<string, OntologyEntity[]>()
  const entityById = new Map<string, OntologyEntity>()
  for (const e of graph.entities) {
    entityById.set(e.id, e)
    const arr = entitiesByFile.get(e.filePath) || []
    arr.push(e)
    entitiesByFile.set(e.filePath, arr)
  }

  // Build adjacency list (bidirectional for proximity)
  const neighbors = new Map<string, Set<string>>()
  for (const r of graph.relations) {
    if (!CROSS_FILE_TYPES.has(r.type)) continue
    if (!neighbors.has(r.source)) neighbors.set(r.source, new Set())
    if (!neighbors.has(r.target)) neighbors.set(r.target, new Set())
    neighbors.get(r.source)!.add(r.target)
    neighbors.get(r.target)!.add(r.source)
  }

  // Find entities matching the query by name
  const queryLower = query.toLowerCase()
  const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 1)
  const matchedEntityIds = new Set<string>()
  for (const e of graph.entities) {
    const nameLower = e.name.toLowerCase()
    if (nameLower === queryLower || queryTokens.some(t => nameLower.includes(t))) {
      matchedEntityIds.add(e.id)
    }
  }

  // Compute proximity set (entities within maxHops of matched entities)
  const proximityScores = new Map<string, number>()
  for (const startId of matchedEntityIds) {
    let frontier = new Set([startId])
    const visited = new Set([startId])
    for (let hop = 1; hop <= maxHops; hop++) {
      const next = new Set<string>()
      for (const id of frontier) {
        const nbrs = neighbors.get(id)
        if (!nbrs) continue
        for (const nid of nbrs) {
          if (visited.has(nid)) continue
          visited.add(nid)
          next.add(nid)
          const decay = 1 / hop
          const current = proximityScores.get(nid) || 0
          proximityScores.set(nid, Math.max(current, decay))
        }
      }
      frontier = next
    }
  }

  // Compute per-file coupling (number of cross-file relations)
  const fileCoupling = new Map<string, number>()
  for (const r of graph.relations) {
    const src = entityById.get(r.source)
    const tgt = entityById.get(r.target)
    if (!src || !tgt || src.filePath === tgt.filePath) continue
    fileCoupling.set(src.filePath, (fileCoupling.get(src.filePath) || 0) + 1)
    fileCoupling.set(tgt.filePath, (fileCoupling.get(tgt.filePath) || 0) + 1)
  }
  const maxCoupling = Math.max(...fileCoupling.values(), 1)

  // Rerank
  const reranked: RankedResult[] = results.map(r => {
    const filePath = r.metadata.filePath || r.id
    const fileEnts = entitiesByFile.get(filePath) || []
    let boost = 0
    const reasons: string[] = []

    // 1. Entity match boost
    const hasMatch = fileEnts.some(e => matchedEntityIds.has(e.id))
    if (hasMatch) {
      boost += entityMatchWeight
      reasons.push('entity-match')
    }

    // 2. Proximity boost
    let maxProx = 0
    for (const e of fileEnts) {
      const ps = proximityScores.get(e.id) || 0
      if (ps > maxProx) maxProx = ps
    }
    if (maxProx > 0) {
      boost += proximityWeight * maxProx
      reasons.push('proximity')
    }

    // 3. Coupling penalty
    const coupling = fileCoupling.get(filePath) || 0
    if (coupling > 0) {
      const normalized = coupling / maxCoupling
      if (normalized > 0.8) {
        boost -= couplingPenaltyWeight * normalized
        reasons.push('high-coupling')
      }
    }

    return {
      ...r,
      originalScore: r.score,
      score: r.score + boost,
      boostReason: reasons.join(', ') || undefined,
    }
  })

  return reranked.sort((a, b) => b.score - a.score)
}
