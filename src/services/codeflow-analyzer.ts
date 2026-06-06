/**
 * Code Flow Analyzer — generates DeepWiki-style Codemaps.
 *
 * A Codemap is a hierarchical, step-by-step walkthrough of how code flows
 * through the application. Unlike a simple dependency graph, it shows the
 * *execution order* with numbered steps (1a, 1b, 1c…), code snippets,
 * and file:line references.
 *
 * Generation strategy:
 *   1. Identify entry points (exported functions, components, route handlers)
 *   2. BFS/DFS through call chains to build ordered steps
 *   3. Group steps into logical sections (initialization, routing, rendering…)
 *   4. Attach code context (signature, file:line) to each step
 *
 * Pure function: (graph) → CodeFlowMap[]
 */

import type {
  OntologyEntity,
  OntologyGraph,
  OntologyEntityType,
} from '../types'

// ── Public types ──────────────────────────────────────────────────────

export interface CodeFlowStep {
  /** e.g. "1a", "2b", "3c" */
  stepId: string
  /** Short label for the step */
  label: string
  /** Code snippet (signature or key line) */
  codeSnippet?: string
  /** File reference */
  filePath: string
  /** Line reference (e.g. "main.ts:12") */
  fileRef: string
  /** The underlying entity */
  entityId: string
  entityName: string
  entityType: OntologyEntityType
  /** Indentation level for nesting */
  depth: number
}

export interface CodeFlowSection {
  /** Section number (1, 2, 3…) */
  sectionNumber: number
  /** Section title (e.g. "Application Initialization") */
  title: string
  /** Short description */
  description: string
  /** Ordered steps within this section */
  steps: CodeFlowStep[]
  /** Whether section is collapsible (default true) */
  collapsible: boolean
}

export interface CodeFlowMap {
  /** Unique id for this flow map */
  id: string
  /** Display title (e.g. "Frontend Application Flow") */
  title: string
  /** Short description */
  description: string
  /** Ordered sections */
  sections: CodeFlowSection[]
  /** Timestamp of generation */
  createdAt: number
  /** Source entity count used */
  entityCount: number
}

export interface CodeFlowSuggestion {
  title: string
  description: string
  /** Seed entity IDs to start the flow from */
  seedEntityIds: string[]
}

// ── Main generator ───────────────────────────────────────────────────

/**
 * Analyze the ontology graph and generate flow maps for major subsystems.
 */
export function generateCodeFlowMaps(graph: OntologyGraph): CodeFlowMap[] {
  const flows: CodeFlowMap[] = []

  const fileGroups = groupEntitiesByDirectory(graph)
  const entryPoints = findEntryPoints(graph)

  if (entryPoints.length > 0) {
    const mainFlow = buildFlowFromEntryPoints(graph, entryPoints, fileGroups)
    if (mainFlow.sections.length > 0) {
      flows.push(mainFlow)
    }
  }

  const moduleFlows = buildModuleFlows(graph, fileGroups)
  flows.push(...moduleFlows)

  return flows
}

/**
 * Generate suggestions for codemaps based on graph structure.
 */
export function suggestCodeFlows(graph: OntologyGraph): CodeFlowSuggestion[] {
  const suggestions: CodeFlowSuggestion[] = []

  const components = graph.entities.filter(e => e.type === 'Component')
  if (components.length > 0) {
    suggestions.push({
      title: 'Component Rendering Flow',
      description: `Traces how ${components.length} components render and interact`,
      seedEntityIds: components.slice(0, 5).map(e => e.id),
    })
  }

  const classes = graph.entities.filter(e => e.type === 'Class')
  if (classes.length > 0) {
    const hub = classes.reduce((best, cls) => {
      const degree = graph.relations.filter(
        r => r.source === cls.id || r.target === cls.id,
      ).length
      const bestDegree = graph.relations.filter(
        r => r.source === best.id || r.target === best.id,
      ).length
      return degree > bestDegree ? cls : best
    }, classes[0])
    suggestions.push({
      title: `${hub.name} Service Flow`,
      description: `Core class with highest connectivity — traces its callers and callees`,
      seedEntityIds: [hub.id],
    })
  }

  const entryPoints = findEntryPoints(graph)
  if (entryPoints.length > 0) {
    suggestions.push({
      title: 'Application Entry Point Flow',
      description: `Traces execution from ${entryPoints.length} entry point(s) through the call chain`,
      seedEntityIds: entryPoints.slice(0, 5).map(e => e.id),
    })
  }

  const dirs = new Set(graph.entities.map(e => {
    const parts = e.filePath.split('/')
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
  }))
  if (dirs.size > 3) {
    let seeds = graph.entities
      .filter(e => e.type === 'Module' || e.type === 'File')
      .slice(0, 5)
      .map(e => e.id)
    if (seeds.length === 0) {
      const seenDirs = new Set<string>()
      seeds = graph.entities
        .filter(e => {
          const dir = e.filePath.split('/').slice(0, -1).join('/')
          if (seenDirs.has(dir)) return false
          seenDirs.add(dir)
          return true
        })
        .slice(0, 5)
        .map(e => e.id)
    }
    if (seeds.length > 0) {
      suggestions.push({
        title: 'Cross-Module Integration Flow',
        description: `Shows how ${dirs.size} modules interact through imports and calls`,
        seedEntityIds: seeds,
      })
    }
  }

  return suggestions
}

/**
 * Build a single code flow map from a set of seed entities.
 */
export function buildFlowFromSeeds(
  graph: OntologyGraph,
  seedIds: string[],
  title: string,
  description: string,
): CodeFlowMap {
  const seeds = seedIds
    .map(id => graph.entities.find(e => e.id === id))
    .filter((e): e is OntologyEntity => e !== undefined)

  const sections: CodeFlowSection[] = []
  const visited = new Set<string>()

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]
    if (visited.has(seed.id)) continue

    const steps = bfsCallChain(graph, seed, visited, 10)
    if (steps.length === 0) continue

    const sectionNum = sections.length + 1
    const numberedSteps = steps.map((step, idx) => ({
      ...step,
      stepId: `${sectionNum}${String.fromCharCode(97 + Math.min(idx, 25))}`,
    }))

    sections.push({
      sectionNumber: sectionNum,
      title: formatSectionTitle(seed, graph),
      description: formatSectionDescription(seed, numberedSteps.length),
      steps: numberedSteps,
      collapsible: true,
    })
  }

  return {
    id: `flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    sections,
    createdAt: Date.now(),
    entityCount: visited.size,
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

function findEntryPoints(graph: OntologyGraph): OntologyEntity[] {
  const entryTypes: OntologyEntityType[] = ['Component', 'Function', 'Class']
  const exported = new Set(
    graph.relations
      .filter(r => r.type === 'exports')
      .map(r => r.target),
  )

  const entries = graph.entities.filter(e => {
    if (!entryTypes.includes(e.type)) return false
    if (exported.has(e.id)) return true
    const callers = graph.relations.filter(r => r.type === 'calls' && r.target === e.id)
    if (callers.length === 0) {
      const callees = graph.relations.filter(r => r.type === 'calls' && r.source === e.id)
      return callees.length > 0
    }
    return false
  })

  entries.sort((a, b) => {
    const aDeg = graph.relations.filter(r => r.source === a.id || r.target === a.id).length
    const bDeg = graph.relations.filter(r => r.source === b.id || r.target === b.id).length
    return bDeg - aDeg
  })

  return entries.slice(0, 10)
}

function groupEntitiesByDirectory(
  graph: OntologyGraph,
): Map<string, OntologyEntity[]> {
  const groups = new Map<string, OntologyEntity[]>()
  for (const entity of graph.entities) {
    const parts = entity.filePath.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    const list = groups.get(dir) ?? []
    list.push(entity)
    groups.set(dir, list)
  }
  return groups
}

function bfsCallChain(
  graph: OntologyGraph,
  seed: OntologyEntity,
  visited: Set<string>,
  maxSteps: number,
): Omit<CodeFlowStep, 'stepId'>[] {
  const steps: Omit<CodeFlowStep, 'stepId'>[] = []
  const queue: { entity: OntologyEntity; depth: number }[] = [{ entity: seed, depth: 0 }]

  while (queue.length > 0 && steps.length < maxSteps) {
    const item = queue.shift()
    if (!item) break
    const { entity, depth } = item
    if (visited.has(entity.id)) continue
    visited.add(entity.id)

    const fileName = entity.filePath.split('/').pop() ?? entity.filePath

    steps.push({
      label: formatStepLabel(entity),
      codeSnippet: entity.signature ?? undefined,
      filePath: entity.filePath,
      fileRef: `${fileName}:${entity.line}`,
      entityId: entity.id,
      entityName: entity.name,
      entityType: entity.type,
      depth,
    })

    const callees = graph.relations
      .filter(r => r.source === entity.id && (r.type === 'calls' || r.type === 'uses' || r.type === 'contains'))
      .map(r => graph.entities.find(e => e.id === r.target))
      .filter((e): e is OntologyEntity => e !== undefined && !visited.has(e.id))

    callees.sort((a, b) => a.line - b.line)
    for (const callee of callees) {
      queue.push({ entity: callee, depth: depth + 1 })
    }
  }

  return steps
}

function buildFlowFromEntryPoints(
  graph: OntologyGraph,
  entryPoints: OntologyEntity[],
  _fileGroups: Map<string, OntologyEntity[]>,
): CodeFlowMap {
  return buildFlowFromSeeds(
    graph,
    entryPoints.map(e => e.id),
    'Application Architecture Flow',
    `Complete application flow traced from ${entryPoints.length} entry point(s), covering initialization, routing, rendering, and core services.`,
  )
}

function buildModuleFlows(
  graph: OntologyGraph,
  fileGroups: Map<string, OntologyEntity[]>,
): CodeFlowMap[] {
  const flows: CodeFlowMap[] = []

  const significantDirs = [...fileGroups.entries()]
    .filter(([, entities]) => entities.length >= 3)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5)

  for (const [dir, entities] of significantDirs) {
    const dirName = dir.split('/').pop() ?? dir
    const roots = entities.filter(e => {
      const callers = graph.relations.filter(
        r => r.type === 'calls' && r.target === e.id && !entities.some(ent => ent.id === r.source),
      )
      return callers.length > 0 || e.type === 'Component' || e.type === 'Class'
    })

    if (roots.length === 0) continue

    const seedIds = roots.slice(0, 5).map(e => e.id)
    const flow = buildFlowFromSeeds(
      graph,
      seedIds,
      `${capitalizeFirst(dirName)} Module Flow`,
      `Internal flow of the \`${dir}\` module (${entities.length} entities).`,
    )

    if (flow.sections.length > 0) {
      flows.push(flow)
    }
  }

  return flows
}

function formatStepLabel(entity: OntologyEntity): string {
  switch (entity.type) {
    case 'Component':
      return `${entity.name} rendering`
    case 'Function':
    case 'Method':
      return entity.name
    case 'Class':
      return `${entity.name} class`
    case 'Interface':
      return `${entity.name} interface`
    case 'Module':
    case 'File':
      return `${entity.name} module`
    default:
      return entity.name
  }
}

function formatSectionTitle(entity: OntologyEntity, graph: OntologyGraph): string {
  const container = graph.relations
    .filter(r => r.type === 'contains' && r.target === entity.id)
    .map(r => graph.entities.find(e => e.id === r.source))
    .filter(Boolean)[0]

  if (container) {
    return `${container.name} — ${entity.name}`
  }

  const fileName = entity.filePath.split('/').pop() ?? entity.filePath
  return `${fileName} (${entity.type})`
}

function formatSectionDescription(entity: OntologyEntity, stepCount: number): string {
  return `Traces ${stepCount} step(s) starting from \`${entity.name}\` (${entity.type}).`
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
