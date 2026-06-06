/**
 * Architecture Diagram Generator
 *
 * Auto-generates Mermaid architecture diagrams from the ontology graph.
 * Three diagram types:
 *   1. **Module dependency** — directory-level flowchart
 *   2. **Class hierarchy** — inheritance + implementation diagram
 *   3. **Component interaction** — data flow between components
 *
 * Pure function — ontology graph in → Mermaid source string out.
 */

import type { OntologyGraph, OntologyEntity } from '../types'

export type DiagramType = 'module-dependency' | 'class-hierarchy' | 'component-flow' | 'sequence'

export interface DiagramOptions {
  /** Max nodes to include (default 30). Largest modules/classes first. */
  maxNodes?: number
  /** Module aggregation depth (default 2, e.g. "src/services"). */
  moduleDepth?: number
  /** Minimum entity count for a module to appear (default 2). */
  minEntities?: number
  /** Direction for flowchart: TB, LR, BT, RL (default TB). */
  direction?: string
}

function sanitize(label: string): string {
  return label.replace(/[^a-zA-Z0-9_/-]/g, '_')
}

function mermaidId(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_')
}

function dirOf(filePath: string, depth: number): string {
  const parts = filePath.split('/')
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || '.'
}

// ── Module dependency diagram ───────────────────────────────────────────

export function generateModuleDependencyDiagram(
  graph: OntologyGraph,
  options: DiagramOptions = {},
): string {
  const {
    maxNodes = 30,
    moduleDepth = 2,
    minEntities = 2,
    direction = 'LR',
  } = options

  const entityById = new Map<string, OntologyEntity>()
  const moduleCounts = new Map<string, number>()

  for (const e of graph.entities) {
    entityById.set(e.id, e)
    const mod = dirOf(e.filePath, moduleDepth)
    moduleCounts.set(mod, (moduleCounts.get(mod) || 0) + 1)
  }

  // Filter modules by min entities, take top N
  const modules = [...moduleCounts.entries()]
    .filter(([, count]) => count >= minEntities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNodes)
  const moduleSet = new Set(modules.map(([m]) => m))

  // Collect cross-module relations
  const edges = new Map<string, number>()
  for (const r of graph.relations) {
    const src = entityById.get(r.source)
    const tgt = entityById.get(r.target)
    if (!src || !tgt) continue
    const srcMod = dirOf(src.filePath, moduleDepth)
    const tgtMod = dirOf(tgt.filePath, moduleDepth)
    if (srcMod === tgtMod || !moduleSet.has(srcMod) || !moduleSet.has(tgtMod)) continue
    const key = `${srcMod}||${tgtMod}`
    edges.set(key, (edges.get(key) || 0) + 1)
  }

  const lines: string[] = [`flowchart ${direction}`]

  // Nodes
  for (const [mod, count] of modules) {
    const id = mermaidId(mod)
    const label = mod.split('/').pop() || mod
    lines.push(`  ${id}["${sanitize(label)}<br/><small>${count} entities</small>"]`)
  }

  // Edges
  for (const [key, weight] of edges) {
    const [src, tgt] = key.split('||')
    const srcId = mermaidId(src)
    const tgtId = mermaidId(tgt)
    const label = weight > 1 ? `|${weight}|` : ''
    lines.push(`  ${srcId} -->${label} ${tgtId}`)
  }

  // Styling
  lines.push('  classDef default fill:#1c2128,stroke:#30363d,color:#e6edf3')

  return lines.join('\n')
}

// ── Class hierarchy diagram ─────────────────────────────────────────────

export function generateClassHierarchyDiagram(
  graph: OntologyGraph,
  options: DiagramOptions = {},
): string {
  const { maxNodes = 30, direction = 'TB' } = options

  const classes = graph.entities
    .filter(e => e.type === 'Class' || e.type === 'Interface')
    .slice(0, maxNodes * 2)

  const classIds = new Set(classes.map(c => c.id))

  // Filter hierarchy relations
  const hierarchyRelations = graph.relations.filter(
    r => (r.type === 'extends' || r.type === 'implements') &&
         classIds.has(r.source) && classIds.has(r.target),
  )

  // Only include entities that participate in hierarchy
  const participatingIds = new Set<string>()
  for (const r of hierarchyRelations) {
    participatingIds.add(r.source)
    participatingIds.add(r.target)
  }

  const nodes = classes
    .filter(e => participatingIds.has(e.id))
    .slice(0, maxNodes)

  if (nodes.length === 0) {
    return `flowchart ${direction}\n  empty["No class hierarchy found"]`
  }

  const nodeSet = new Set(nodes.map(n => n.id))
  const lines: string[] = [`flowchart ${direction}`]

  // Nodes
  for (const node of nodes) {
    const id = mermaidId(node.id)
    const shape = node.type === 'Interface' ? `([${sanitize(node.name)}])` : `["${sanitize(node.name)}"]`
    lines.push(`  ${id}${shape}`)
  }

  // Edges
  for (const r of hierarchyRelations) {
    if (!nodeSet.has(r.source) || !nodeSet.has(r.target)) continue
    const srcId = mermaidId(r.source)
    const tgtId = mermaidId(r.target)
    const arrow = r.type === 'implements' ? '-.->|implements|' : '-->|extends|'
    lines.push(`  ${srcId} ${arrow} ${tgtId}`)
  }

  lines.push('  classDef default fill:#1c2128,stroke:#30363d,color:#e6edf3')
  lines.push('  classDef interface fill:#1c2128,stroke:#bc8cff,color:#bc8cff')

  const interfaceIds = nodes.filter(n => n.type === 'Interface').map(n => mermaidId(n.id))
  if (interfaceIds.length > 0) {
    lines.push(`  class ${interfaceIds.join(',')} interface`)
  }

  return lines.join('\n')
}

// ── Component interaction diagram ───────────────────────────────────────

export function generateComponentFlowDiagram(
  graph: OntologyGraph,
  options: DiagramOptions = {},
): string {
  const { maxNodes = 25, direction = 'LR' } = options

  // Focus on Component and Module type entities
  const components = graph.entities
    .filter(e => e.type === 'Component' || e.type === 'Module' || e.type === 'Class')

  if (components.length === 0) {
    return `flowchart ${direction}\n  empty["No components found"]`
  }

  const compIds = new Set(components.map(c => c.id))

  // Count relations per component (for sizing/importance)
  const relCount = new Map<string, number>()
  for (const r of graph.relations) {
    if (!compIds.has(r.source) && !compIds.has(r.target)) continue
    if (compIds.has(r.source)) relCount.set(r.source, (relCount.get(r.source) || 0) + 1)
    if (compIds.has(r.target)) relCount.set(r.target, (relCount.get(r.target) || 0) + 1)
  }

  // Take top-N by relation count
  const topComponents = components
    .sort((a, b) => (relCount.get(b.id) || 0) - (relCount.get(a.id) || 0))
    .slice(0, maxNodes)
  const topSet = new Set(topComponents.map(c => c.id))

  // Collect relevant edges
  const flowEdges = graph.relations
    .filter(r =>
      topSet.has(r.source) && topSet.has(r.target) &&
      r.source !== r.target &&
      (r.type === 'calls' || r.type === 'uses' || r.type === 'imports' || r.type === 'dependsOn'),
    )

  const lines: string[] = [`flowchart ${direction}`]

  for (const comp of topComponents) {
    const id = mermaidId(comp.id)
    const icon = comp.type === 'Component' ? '🧩 ' : comp.type === 'Module' ? '📦 ' : ''
    lines.push(`  ${id}["${icon}${sanitize(comp.name)}"]`)
  }

  // Deduplicate edges
  const edgeKeys = new Set<string>()
  for (const r of flowEdges) {
    const key = `${r.source}||${r.target}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    const srcId = mermaidId(r.source)
    const tgtId = mermaidId(r.target)
    lines.push(`  ${srcId} --> ${tgtId}`)
  }

  lines.push('  classDef default fill:#1c2128,stroke:#30363d,color:#e6edf3')

  return lines.join('\n')
}

/**
 * Generate all diagram types for a project.
 */
export function generateAllDiagrams(
  graph: OntologyGraph,
  options: DiagramOptions = {},
): { type: DiagramType; title: string; mermaid: string }[] {
  return [
    {
      type: 'module-dependency',
      title: 'Module Dependencies',
      mermaid: generateModuleDependencyDiagram(graph, options),
    },
    {
      type: 'class-hierarchy',
      title: 'Class Hierarchy',
      mermaid: generateClassHierarchyDiagram(graph, options),
    },
    {
      type: 'component-flow',
      title: 'Component Interactions',
      mermaid: generateComponentFlowDiagram(graph, options),
    },
    {
      type: 'sequence',
      title: 'Call Sequence',
      mermaid: generateSequenceDiagram(graph, options),
    },
  ]
}

// ── Sequence diagram ──────────────────────────────────────────────────────

/**
 * Generate a Mermaid sequence diagram showing call chains between
 * top-level entities (Functions/Methods calling other Functions/Methods).
 */
export function generateSequenceDiagram(
  graph: OntologyGraph,
  options: DiagramOptions = {},
): string {
  const { maxNodes = 20 } = options
  const lines: string[] = ['sequenceDiagram']

  // Find call-type relations between different entities
  const callRels = graph.relations.filter(r =>
    r.type === 'calls' || r.type === 'uses' || r.type === 'dependsOn',
  )

  const entityById = new Map(graph.entities.map(e => [e.id, e]))

  // Build participant set (order by first appearance)
  const participants = new Map<string, string>()
  const interactions: Array<{ from: string; to: string; label: string }> = []

  for (const r of callRels.slice(0, maxNodes * 2)) {
    const src = entityById.get(r.source)
    const tgt = entityById.get(r.target)
    if (!src || !tgt || src.id === tgt.id) continue

    const srcKey = sanitize(src.name)
    const tgtKey = sanitize(tgt.name)
    if (!participants.has(srcKey)) participants.set(srcKey, src.name)
    if (!participants.has(tgtKey)) participants.set(tgtKey, tgt.name)

    interactions.push({ from: srcKey, to: tgtKey, label: r.type })

    if (participants.size >= maxNodes) break
  }

  if (interactions.length === 0) {
    return 'sequenceDiagram\n  Note over System: No call sequences found'
  }

  for (const [key, name] of participants) {
    lines.push(`  participant ${key} as ${name}`)
  }

  for (const { from, to, label } of interactions.slice(0, 30)) {
    lines.push(`  ${from}->>+${to}: ${label}`)
    lines.push(`  ${to}-->>-${from}: return`)
  }

  return lines.join('\n')
}

// ── PlantUML export ───────────────────────────────────────────────────────

/**
 * Convert a Mermaid module-dependency diagram to PlantUML format.
 */
export function toPlantUML(
  graph: OntologyGraph,
  options: DiagramOptions = {},
): string {
  const { moduleDepth = 2, minEntities = 2 } = options
  const lines: string[] = ['@startuml', 'skinparam packageStyle rectangle']

  // Build modules
  const modules = new Map<string, Set<string>>()
  for (const e of graph.entities) {
    const parts = e.filePath.split('/')
    const mod = parts.slice(0, moduleDepth).join('/')
    if (!modules.has(mod)) modules.set(mod, new Set())
    modules.get(mod)!.add(e.id)
  }

  // Filter small modules
  const filtered = [...modules.entries()].filter(([, ids]) => ids.size >= minEntities)

  for (const [mod, ids] of filtered) {
    lines.push(`package "${mod}" {`)
    const entities = graph.entities.filter(e => ids.has(e.id)).slice(0, 5)
    for (const e of entities) {
      const stereotype = e.type === 'Class' ? 'class' : e.type === 'Interface' ? 'interface' : 'object'
      lines.push(`  ${stereotype} ${sanitize(e.name)}`)
    }
    lines.push('}')
  }

  // Add dependencies
  const entityById = new Map(graph.entities.map(e => [e.id, e]))
  const entityToModule = new Map<string, string>()
  for (const e of graph.entities) {
    const parts = e.filePath.split('/')
    entityToModule.set(e.id, parts.slice(0, moduleDepth).join('/'))
  }

  const seenDeps = new Set<string>()
  for (const r of graph.relations) {
    const srcMod = entityToModule.get(r.source)
    const tgtMod = entityToModule.get(r.target)
    if (!srcMod || !tgtMod || srcMod === tgtMod) continue

    const src = entityById.get(r.source)
    const tgt = entityById.get(r.target)
    if (!src || !tgt) continue

    const key = `${sanitize(src.name)}->${sanitize(tgt.name)}`
    if (seenDeps.has(key)) continue
    seenDeps.add(key)

    lines.push(`${sanitize(src.name)} --> ${sanitize(tgt.name)} : ${r.type}`)
    if (seenDeps.size >= 30) break
  }

  lines.push('@enduml')
  return lines.join('\n')
}
