/**
 * Graph Persistence Service
 *
 * Provides standalone file-based persistence for the ontology graph,
 * independent of the Electron IPC cache. Supports:
 *   - Saving/loading the full ontology graph to/from `.codewiki/graph.json`
 *   - Incremental graph merge (add new entities/relations without full rebuild)
 *   - Graph versioning with metadata (timestamp, project info)
 *
 * Works in both Electron and Node.js CLI environments by accepting a
 * simple read/write file interface.
 */

import type { OntologyGraph, OntologyEntity, OntologyRelation } from '../types'

export const GRAPH_FILE = '.codewiki/graph.json'
export const GRAPH_VERSION = 1

export interface PersistedGraph {
  version: number
  projectName: string
  projectPath: string
  generatedAt: number
  entityCount: number
  relationCount: number
  graph: OntologyGraph
}

export interface FileIO {
  readFile(path: string): Promise<string | null>
  writeFile(path: string, content: string): Promise<void>
  ensureDir(path: string): Promise<void>
}

/**
 * Save an ontology graph to disk as `.codewiki/graph.json`.
 */
export async function saveGraph(
  projectPath: string,
  projectName: string,
  graph: OntologyGraph,
  io: FileIO,
): Promise<void> {
  const sep = projectPath.includes('\\') ? '\\' : '/'
  const dir = projectPath + sep + '.codewiki'
  const filePath = dir + sep + 'graph.json'

  await io.ensureDir(dir)

  const persisted: PersistedGraph = {
    version: GRAPH_VERSION,
    projectName,
    projectPath,
    generatedAt: Date.now(),
    entityCount: graph.entities.length,
    relationCount: graph.relations.length,
    graph,
  }

  await io.writeFile(filePath, JSON.stringify(persisted))
}

/**
 * Load a previously persisted ontology graph.
 * Returns null if no graph file exists or it cannot be parsed.
 */
export async function loadGraph(
  projectPath: string,
  io: FileIO,
): Promise<PersistedGraph | null> {
  const sep = projectPath.includes('\\') ? '\\' : '/'
  const filePath = projectPath + sep + '.codewiki' + sep + 'graph.json'

  try {
    const content = await io.readFile(filePath)
    if (!content) return null
    const parsed = JSON.parse(content) as PersistedGraph
    if (parsed.version !== GRAPH_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Merge new entities and relations into an existing graph.
 * Deduplicates by entity id and relation id.
 */
export function mergeGraphs(
  base: OntologyGraph,
  incoming: OntologyGraph,
): OntologyGraph {
  const entityIds = new Set(base.entities.map(e => e.id))
  const relationIds = new Set(base.relations.map(r => r.id))

  const newEntities: OntologyEntity[] = []
  for (const e of incoming.entities) {
    if (!entityIds.has(e.id)) {
      newEntities.push(e)
      entityIds.add(e.id)
    }
  }

  const newRelations: OntologyRelation[] = []
  for (const r of incoming.relations) {
    if (!relationIds.has(r.id)) {
      newRelations.push(r)
      relationIds.add(r.id)
    }
  }

  return {
    entities: [...base.entities, ...newEntities],
    relations: [...base.relations, ...newRelations],
  }
}

/**
 * Remove entities (and their relations) belonging to specified file paths.
 * Used for incremental update: remove stale entries, then merge fresh ones.
 */
export function removeFileEntities(
  graph: OntologyGraph,
  filePaths: Set<string>,
): OntologyGraph {
  const entities = graph.entities.filter(e => !filePaths.has(e.filePath))
  const entityIds = new Set(entities.map(e => e.id))
  const relations = graph.relations.filter(
    r => entityIds.has(r.source) && entityIds.has(r.target),
  )
  return { entities, relations }
}

/**
 * Compute basic graph statistics.
 */
export function graphStats(graph: OntologyGraph): {
  entities: number
  relations: number
  files: number
  entityTypes: Record<string, number>
  relationTypes: Record<string, number>
} {
  const files = new Set<string>()
  const entityTypes: Record<string, number> = {}
  const relationTypes: Record<string, number> = {}

  for (const e of graph.entities) {
    files.add(e.filePath)
    entityTypes[e.type] = (entityTypes[e.type] || 0) + 1
  }
  for (const r of graph.relations) {
    relationTypes[r.type] = (relationTypes[r.type] || 0) + 1
  }

  return {
    entities: graph.entities.length,
    relations: graph.relations.length,
    files: files.size,
    entityTypes,
    relationTypes,
  }
}
