/**
 * Repo Map for LLM
 *
 * Generates a concise "code map" that AI coding assistants (Cursor, Copilot,
 * Aider, etc.) can use as context. Unlike Aider's PageRank-based repo map,
 * this uses the ontology graph's actual call/dependency relations to produce
 * a more semantically accurate representation.
 *
 * Output format: a compact Markdown-ish text that fits in an LLM context
 * window, listing files → entities → key relations.
 *
 * Pure function — ontology graph in → text out.
 */

import type { OntologyGraph, OntologyEntity } from '../types'

export interface RepoMapOptions {
  /** Max total characters in output. Default 8000. */
  maxChars?: number
  /** Max entities per file. Default 15. */
  maxEntitiesPerFile?: number
  /** Include relation details. Default true. */
  includeRelations?: boolean
  /** Focus on specific files (if provided, only map these). */
  focusFiles?: string[]
  /** Rank files by importance and take top N. Default 50. */
  maxFiles?: number
}

interface FileScore {
  path: string
  entities: OntologyEntity[]
  inDegree: number
  outDegree: number
  importance: number
}

/**
 * Generate a repo map suitable for LLM context.
 */
export function generateRepoMap(
  graph: OntologyGraph,
  options: RepoMapOptions = {},
): string {
  const {
    maxChars = 8000,
    maxEntitiesPerFile = 15,
    includeRelations = true,
    focusFiles,
    maxFiles = 50,
  } = options

  if (graph.entities.length === 0) return '# Repo Map\n\n(empty project)'

  // Group entities by file
  const entsByFile = new Map<string, OntologyEntity[]>()
  const entityById = new Map<string, OntologyEntity>()
  for (const e of graph.entities) {
    entityById.set(e.id, e)
    const arr = entsByFile.get(e.filePath) || []
    arr.push(e)
    entsByFile.set(e.filePath, arr)
  }

  // Compute file importance (in-degree + out-degree + entity count)
  const fileIn = new Map<string, number>()
  const fileOut = new Map<string, number>()
  for (const r of graph.relations) {
    const src = entityById.get(r.source)
    const tgt = entityById.get(r.target)
    if (!src || !tgt) continue
    if (src.filePath !== tgt.filePath) {
      fileOut.set(src.filePath, (fileOut.get(src.filePath) || 0) + 1)
      fileIn.set(tgt.filePath, (fileIn.get(tgt.filePath) || 0) + 1)
    }
  }

  const files: FileScore[] = []
  for (const [path, ents] of entsByFile) {
    if (focusFiles && !focusFiles.includes(path)) continue
    const inD = fileIn.get(path) || 0
    const outD = fileOut.get(path) || 0
    files.push({
      path,
      entities: ents,
      inDegree: inD,
      outDegree: outD,
      importance: inD + outD + ents.length,
    })
  }

  files.sort((a, b) => b.importance - a.importance)
  const topFiles = files.slice(0, maxFiles)

  // Build output
  const lines: string[] = ['# Repo Map', '']
  lines.push(`${graph.entities.length} entities, ${graph.relations.length} relations across ${entsByFile.size} files`)
  lines.push('')

  let charCount = lines.join('\n').length

  for (const file of topFiles) {
    const header = `## ${file.path}`
    if (charCount + header.length + 10 > maxChars) break

    lines.push(header)
    charCount += header.length + 1

    const sortedEnts = file.entities
      .sort((a, b) => a.line - b.line)
      .slice(0, maxEntitiesPerFile)

    for (const e of sortedEnts) {
      const sig = e.signature ? `: ${e.signature.slice(0, 80)}` : ''
      const line = `  ${e.type} ${e.name}${sig} (L${e.line})`
      if (charCount + line.length + 1 > maxChars) break
      lines.push(line)
      charCount += line.length + 1
    }

    if (includeRelations) {
      const fileEntityIds = new Set(file.entities.map(e => e.id))
      const outRels = graph.relations.filter(r =>
        fileEntityIds.has(r.source) && !fileEntityIds.has(r.target),
      )

      // Group by target file
      const relsByTarget = new Map<string, string[]>()
      for (const r of outRels) {
        const tgt = entityById.get(r.target)
        if (!tgt) continue
        const arr = relsByTarget.get(tgt.filePath) || []
        const src = entityById.get(r.source)
        arr.push(`${src?.name || '?'} -${r.type}-> ${tgt.name}`)
        relsByTarget.set(tgt.filePath, arr)
      }

      if (relsByTarget.size > 0) {
        const relLine = `  → depends on: ${[...relsByTarget.keys()].join(', ')}`
        if (charCount + relLine.length + 1 <= maxChars) {
          lines.push(relLine)
          charCount += relLine.length + 1
        }
      }
    }

    lines.push('')
    charCount += 1
  }

  return lines.join('\n')
}

/**
 * Generate a focused repo map for files relevant to a specific query/file.
 * Uses the ontology graph to find related files within N hops.
 */
export function generateFocusedRepoMap(
  graph: OntologyGraph,
  seedFiles: string[],
  hops: number = 2,
  options: RepoMapOptions = {},
): string {
  const entityById = new Map(graph.entities.map(e => [e.id, e]))

  // Find entities in seed files
  const seedEntIds = new Set(
    graph.entities
      .filter(e => seedFiles.some(f => e.filePath.endsWith(f)))
      .map(e => e.id),
  )

  // BFS to find related files
  const relatedFiles = new Set(seedFiles)
  let frontier = new Set(seedEntIds)
  const visited = new Set(seedEntIds)

  for (let h = 0; h < hops; h++) {
    const next = new Set<string>()
    for (const id of frontier) {
      for (const r of graph.relations) {
        const otherId = r.source === id ? r.target : r.target === id ? r.source : null
        if (!otherId || visited.has(otherId)) continue
        visited.add(otherId)
        next.add(otherId)
        const e = entityById.get(otherId)
        if (e) relatedFiles.add(e.filePath)
      }
    }
    frontier = next
  }

  return generateRepoMap(graph, { ...options, focusFiles: [...relatedFiles] })
}
