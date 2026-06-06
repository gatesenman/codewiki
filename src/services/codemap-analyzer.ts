/**
 * Code Map Analyzer
 *
 * Aggregates the ontology graph into a higher-level module/directory dependency
 * map suitable for a DeepWiki-style "Code Map" visualization.
 *
 * Produces three complementary views:
 *   1. **Directory tree** with per-node metrics (entity count, LOC, complexity)
 *   2. **Module dependency graph** (directory-level edges derived from entity
 *      relations across files)
 *   3. **File detail** records enriched with entity summaries
 */

import type {
  OntologyGraph,
  OntologyEntity,
  OntologyEntityType,
  FileNode,
} from '../types'

// ── Public types ────────────────────────────────────────────────────────

export interface CodeMapNode {
  /** Directory or file relative path (e.g. "src/services") */
  path: string
  name: string
  type: 'directory' | 'file'
  children: CodeMapNode[]
  /** Number of ontology entities in this node (recursive for dirs) */
  entityCount: number
  /** Breakdown by entity type */
  entityBreakdown: Partial<Record<OntologyEntityType, number>>
  /** Estimated lines of code (from entity line ranges) */
  maxLine: number
  /** Number of inbound cross-module relations */
  inDegree: number
  /** Number of outbound cross-module relations */
  outDegree: number
  /** Coupling score 0-1 (normalized total degree) */
  coupling: number
}

export interface ModuleDependency {
  source: string   // directory path
  target: string   // directory path
  /** Number of entity-level relations that cross these modules */
  weight: number
  /** Dominant relation type across the edge */
  dominantType: string
}

export interface FileDetail {
  path: string
  name: string
  entities: EntitySummary[]
  inDegree: number
  outDegree: number
  maxLine: number
}

export interface EntitySummary {
  id: string
  name: string
  type: OntologyEntityType
  line: number
  endLine: number
  signature?: string
  callers: number
  callees: number
}

export interface CodeMapData {
  tree: CodeMapNode
  dependencies: ModuleDependency[]
  files: FileDetail[]
  stats: CodeMapStats
}

export interface CodeMapStats {
  totalFiles: number
  totalEntities: number
  totalRelations: number
  totalDirectories: number
  avgEntitiesPerFile: number
  maxCouplingModule: string
  entityTypeDistribution: Partial<Record<OntologyEntityType, number>>
}

// ── Helpers ─────────────────────────────────────────────────────────────

function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx > 0 ? filePath.substring(0, idx) : '.'
}

function baseName(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx >= 0 ? filePath.substring(idx + 1) : filePath
}

/** Return the top-N directory segments (e.g. depth=2 → "src/services"). */
function dirAtDepth(filePath: string, depth: number): string {
  const parts = filePath.split('/')
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || '.'
}

// ── Core analyzer ───────────────────────────────────────────────────────

export function analyzeCodeMap(
  graph: OntologyGraph,
  _fileTree?: FileNode[],
  moduleDepth = 2,
): CodeMapData {
  const { entities, relations } = graph

  // 1. Build entity → file index
  const entityById = new Map<string, OntologyEntity>()
  const fileEntities = new Map<string, OntologyEntity[]>()
  for (const e of entities) {
    entityById.set(e.id, e)
    const arr = fileEntities.get(e.filePath) || []
    arr.push(e)
    fileEntities.set(e.filePath, arr)
  }

  // 2. Compute per-entity caller/callee counts
  const callerCount = new Map<string, number>()
  const calleeCount = new Map<string, number>()
  for (const r of relations) {
    if (r.type === 'calls' || r.type === 'uses' || r.type === 'dependsOn') {
      calleeCount.set(r.source, (calleeCount.get(r.source) || 0) + 1)
      callerCount.set(r.target, (callerCount.get(r.target) || 0) + 1)
    }
  }

  // 3. Build file detail records
  const files: FileDetail[] = []
  for (const [fp, ents] of fileEntities) {
    const detail: FileDetail = {
      path: fp,
      name: baseName(fp),
      entities: ents.map(e => ({
        id: e.id,
        name: e.name,
        type: e.type,
        line: e.line,
        endLine: e.endLine,
        signature: e.signature,
        callers: callerCount.get(e.id) || 0,
        callees: calleeCount.get(e.id) || 0,
      })),
      inDegree: 0,
      outDegree: 0,
      maxLine: Math.max(...ents.map(e => e.endLine), 0),
    }
    files.push(detail)
  }

  // 4. Compute cross-file relation counts (file-level in/out degree)
  const fileInDegree = new Map<string, number>()
  const fileOutDegree = new Map<string, number>()
  for (const r of relations) {
    const srcEntity = entityById.get(r.source)
    const tgtEntity = entityById.get(r.target)
    if (!srcEntity || !tgtEntity) continue
    if (srcEntity.filePath !== tgtEntity.filePath) {
      fileOutDegree.set(srcEntity.filePath, (fileOutDegree.get(srcEntity.filePath) || 0) + 1)
      fileInDegree.set(tgtEntity.filePath, (fileInDegree.get(tgtEntity.filePath) || 0) + 1)
    }
  }
  for (const f of files) {
    f.inDegree = fileInDegree.get(f.path) || 0
    f.outDegree = fileOutDegree.get(f.path) || 0
  }

  // 5. Build module dependency graph (directory-level)
  const modEdges = new Map<string, { weight: number; types: Map<string, number> }>()
  for (const r of relations) {
    const srcEntity = entityById.get(r.source)
    const tgtEntity = entityById.get(r.target)
    if (!srcEntity || !tgtEntity) continue
    const srcMod = dirAtDepth(srcEntity.filePath, moduleDepth)
    const tgtMod = dirAtDepth(tgtEntity.filePath, moduleDepth)
    if (srcMod === tgtMod) continue
    const key = `${srcMod}||${tgtMod}`
    const edge = modEdges.get(key) || { weight: 0, types: new Map() }
    edge.weight++
    edge.types.set(r.type, (edge.types.get(r.type) || 0) + 1)
    modEdges.set(key, edge)
  }

  const dependencies: ModuleDependency[] = []
  for (const [key, edge] of modEdges) {
    const [source, target] = key.split('||')
    let dominantType = 'imports'
    let maxCount = 0
    for (const [t, c] of edge.types) {
      if (c > maxCount) { maxCount = c; dominantType = t }
    }
    dependencies.push({ source, target, weight: edge.weight, dominantType })
  }

  // 6. Build directory tree with metrics
  const allDirs = new Set<string>()
  for (const fp of fileEntities.keys()) {
    const parts = fp.split('/')
    for (let i = 1; i < parts.length; i++) {
      allDirs.add(parts.slice(0, i).join('/'))
    }
  }

  const dirMetrics = new Map<string, {
    entityCount: number
    breakdown: Partial<Record<OntologyEntityType, number>>
    maxLine: number
    inDegree: number
    outDegree: number
  }>()

  // Init all directories
  for (const d of allDirs) {
    dirMetrics.set(d, { entityCount: 0, breakdown: {}, maxLine: 0, inDegree: 0, outDegree: 0 })
  }

  // Accumulate from files
  for (const [fp, ents] of fileEntities) {
    const parts = fp.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const m = dirMetrics.get(dir)!
      m.entityCount += ents.length
      m.maxLine = Math.max(m.maxLine, ...ents.map(e => e.endLine))
      m.inDegree += fileInDegree.get(fp) || 0
      m.outDegree += fileOutDegree.get(fp) || 0
      for (const e of ents) {
        m.breakdown[e.type] = (m.breakdown[e.type] || 0) + 1
      }
    }
  }

  // Find max total degree for normalization
  let maxDegree = 1
  for (const m of dirMetrics.values()) {
    maxDegree = Math.max(maxDegree, m.inDegree + m.outDegree)
  }

  // Build tree recursively
  function buildTree(dirPath: string): CodeMapNode {
    const childDirs = [...allDirs].filter(d => {
      if (!d.startsWith(dirPath + '/')) return false
      const remainder = d.substring(dirPath.length + 1)
      return !remainder.includes('/')
    })

    const childFiles = [...fileEntities.keys()].filter(fp => {
      return dirOf(fp) === dirPath
    })

    const m = dirMetrics.get(dirPath) || {
      entityCount: 0, breakdown: {}, maxLine: 0, inDegree: 0, outDegree: 0,
    }

    const children: CodeMapNode[] = [
      ...childDirs.map(d => buildTree(d)),
      ...childFiles.map(fp => {
        const ents = fileEntities.get(fp) || []
        const breakdown: Partial<Record<OntologyEntityType, number>> = {}
        for (const e of ents) {
          breakdown[e.type] = (breakdown[e.type] || 0) + 1
        }
        const fin = fileInDegree.get(fp) || 0
        const fout = fileOutDegree.get(fp) || 0
        return {
          path: fp,
          name: baseName(fp),
          type: 'file' as const,
          children: [],
          entityCount: ents.length,
          entityBreakdown: breakdown,
          maxLine: Math.max(...ents.map(e => e.endLine), 0),
          inDegree: fin,
          outDegree: fout,
          coupling: (fin + fout) / maxDegree,
        }
      }),
    ]

    return {
      path: dirPath,
      name: baseName(dirPath),
      type: 'directory',
      children,
      entityCount: m.entityCount,
      entityBreakdown: m.breakdown,
      maxLine: m.maxLine,
      inDegree: m.inDegree,
      outDegree: m.outDegree,
      coupling: (m.inDegree + m.outDegree) / maxDegree,
    }
  }

  // Find the root directory
  const allPaths = [...fileEntities.keys()]
  const rootParts = allPaths[0]?.split('/') || []
  let rootDir = rootParts[0] || '.'
  // Find common prefix
  if (allPaths.length > 1) {
    for (let i = 0; i < rootParts.length; i++) {
      const prefix = rootParts.slice(0, i + 1).join('/')
      if (allPaths.every(p => p.startsWith(prefix + '/') || p === prefix)) {
        rootDir = prefix
      } else break
    }
  }

  const tree = allDirs.has(rootDir)
    ? buildTree(rootDir)
    : {
        path: '.',
        name: '.',
        type: 'directory' as const,
        children: [...allDirs]
          .filter(d => !d.includes('/'))
          .map(d => buildTree(d)),
        entityCount: entities.length,
        entityBreakdown: {},
        maxLine: 0,
        inDegree: 0,
        outDegree: 0,
        coupling: 0,
      }

  // 7. Global stats
  const entityTypeDistribution: Partial<Record<OntologyEntityType, number>> = {}
  for (const e of entities) {
    entityTypeDistribution[e.type] = (entityTypeDistribution[e.type] || 0) + 1
  }

  let maxCouplingModule = '.'
  let maxCoup = 0
  for (const [d, m] of dirMetrics) {
    const c = m.inDegree + m.outDegree
    if (c > maxCoup) { maxCoup = c; maxCouplingModule = d }
  }

  const stats: CodeMapStats = {
    totalFiles: fileEntities.size,
    totalEntities: entities.length,
    totalRelations: relations.length,
    totalDirectories: allDirs.size,
    avgEntitiesPerFile: fileEntities.size > 0 ? Math.round(entities.length / fileEntities.size * 10) / 10 : 0,
    maxCouplingModule,
    entityTypeDistribution,
  }

  return { tree, dependencies, files, stats }
}
