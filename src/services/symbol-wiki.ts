/**
 * Symbol Wiki — generates DeepWiki-style detailed wiki pages for individual
 * code entities (symbols) from the ontology graph.
 *
 * Each symbol page includes:
 *   - Definition (type, signature, file:line, code context)
 *   - Example Usages (callers / dependents with code context)
 *   - Notes (important patterns, risks, coupling info)
 *   - See Also (related entities via direct relations)
 *   - Follow-up Questions (auto-generated questions about the entity)
 *
 * Pure function: (graph, entityId) → SymbolWikiPage
 */

import type {
  OntologyEntity,
  OntologyGraph,
  OntologyRelation,
  OntologyEntityType,
} from '../types'

// ── Public types ──────────────────────────────────────────────────────

export interface SymbolDefinition {
  type: OntologyEntityType
  signature?: string
  filePath: string
  line: number
  endLine: number
  description?: string
  /** e.g. "Value parameter for @Async annotation" */
  context?: string
}

export interface SymbolUsage {
  entity: OntologyEntity
  relationType: string
  /** Short description of how it's used */
  description: string
}

export interface SymbolNote {
  text: string
  severity: 'info' | 'warning'
}

export interface SeeAlsoEntry {
  entity: OntologyEntity
  relation: string
}

export interface SymbolWikiPage {
  entity: OntologyEntity
  definition: SymbolDefinition
  usages: SymbolUsage[]
  notes: SymbolNote[]
  seeAlso: SeeAlsoEntry[]
  followUpQuestions: string[]
  /** Metadata for display */
  metadata: {
    callerCount: number
    calleeCount: number
    totalRelations: number
    couplingScore: number
  }
}

// ── Main generator ───────────────────────────────────────────────────

export function generateSymbolWiki(
  graph: OntologyGraph,
  entityId: string,
): SymbolWikiPage | null {
  const entity = graph.entities.find(e => e.id === entityId)
  if (!entity) return null

  const inbound = graph.relations.filter(r => r.target === entityId)
  const outbound = graph.relations.filter(r => r.source === entityId)
  const allRels = [...inbound, ...outbound]

  const definition = buildDefinition(entity, graph)
  const usages = buildUsages(entity, inbound, graph)
  const notes = buildNotes(entity, inbound, outbound, graph)
  const seeAlso = buildSeeAlso(entity, allRels, graph)
  const followUpQuestions = buildFollowUpQuestions(entity, inbound, outbound, graph)

  const totalDegree = inbound.length + outbound.length
  const maxDegree = Math.max(
    ...graph.entities.map(e => {
      const d = graph.relations.filter(r => r.source === e.id || r.target === e.id).length
      return d
    }),
    1,
  )

  return {
    entity,
    definition,
    usages,
    notes,
    seeAlso,
    followUpQuestions,
    metadata: {
      callerCount: inbound.filter(r => r.type === 'calls').length,
      calleeCount: outbound.filter(r => r.type === 'calls').length,
      totalRelations: allRels.length,
      couplingScore: totalDegree / maxDegree,
    },
  }
}

/**
 * Generate symbol wiki pages for ALL entities in the graph.
 * Returns a map of entityId → SymbolWikiPage.
 */
export function generateAllSymbolWikis(
  graph: OntologyGraph,
): Map<string, SymbolWikiPage> {
  const result = new Map<string, SymbolWikiPage>()
  for (const entity of graph.entities) {
    const page = generateSymbolWiki(graph, entity.id)
    if (page) result.set(entity.id, page)
  }
  return result
}

// ── Definition ───────────────────────────────────────────────────────

function buildDefinition(
  entity: OntologyEntity,
  graph: OntologyGraph,
): SymbolDefinition {
  const container = graph.relations
    .filter(r => r.type === 'contains' && r.target === entity.id)
    .map(r => graph.entities.find(e => e.id === r.source))
    .filter(Boolean)[0]

  let context: string | undefined
  if (container) {
    context = `Defined inside ${container.type.toLowerCase()} \`${container.name}\``
  }

  return {
    type: entity.type,
    signature: entity.signature,
    filePath: entity.filePath,
    line: entity.line,
    endLine: entity.endLine,
    description: entity.description,
    context,
  }
}

// ── Usages ───────────────────────────────────────────────────────────

function buildUsages(
  entity: OntologyEntity,
  inbound: OntologyRelation[],
  graph: OntologyGraph,
): SymbolUsage[] {
  const usages: SymbolUsage[] = []
  const seen = new Set<string>()

  for (const rel of inbound) {
    if (seen.has(rel.source)) continue
    seen.add(rel.source)

    const caller = graph.entities.find(e => e.id === rel.source)
    if (!caller) continue
    if (rel.type === 'contains') continue

    const desc = describeRelation(rel.type, caller, entity)
    usages.push({ entity: caller, relationType: rel.type, description: desc })
  }

  return usages.slice(0, 15)
}

function describeRelation(
  relType: string,
  source: OntologyEntity,
  target: OntologyEntity,
): string {
  switch (relType) {
    case 'calls':
      return `\`${source.name}\` calls \`${target.name}\``
    case 'imports':
      return `\`${source.name}\` imports \`${target.name}\``
    case 'extends':
      return `\`${source.name}\` extends \`${target.name}\``
    case 'implements':
      return `\`${source.name}\` implements \`${target.name}\``
    case 'uses':
      return `\`${source.name}\` uses \`${target.name}\``
    case 'dependsOn':
      return `\`${source.name}\` depends on \`${target.name}\``
    case 'overrides':
      return `\`${source.name}\` overrides \`${target.name}\``
    default:
      return `\`${source.name}\` → \`${target.name}\` (${relType})`
  }
}

// ── Notes ────────────────────────────────────────────────────────────

function buildNotes(
  entity: OntologyEntity,
  inbound: OntologyRelation[],
  outbound: OntologyRelation[],
  graph: OntologyGraph,
): SymbolNote[] {
  const notes: SymbolNote[] = []
  const totalDegree = inbound.length + outbound.length

  if (totalDegree > 15) {
    notes.push({
      text: `High coupling: ${totalDegree} total relations (${inbound.length} inbound, ${outbound.length} outbound). Changes here may have wide impact.`,
      severity: 'warning',
    })
  }

  if (inbound.length === 0 && outbound.length === 0) {
    notes.push({
      text: 'This entity has no detected relations — it may be dead code or indirectly referenced.',
      severity: 'warning',
    })
  }

  if (entity.type === 'Class' || entity.type === 'Interface') {
    const implementors = graph.relations.filter(
      r => (r.type === 'implements' || r.type === 'extends') && r.target === entity.id,
    )
    if (implementors.length > 0) {
      const names = implementors
        .map(r => graph.entities.find(e => e.id === r.source)?.name)
        .filter(Boolean)
        .slice(0, 5)
      notes.push({
        text: `Extended/implemented by: ${names.join(', ')}${implementors.length > 5 ? ` and ${implementors.length - 5} more` : ''}.`,
        severity: 'info',
      })
    }
  }

  const cyclicPeers = outbound.filter(
    out => inbound.some(inp => inp.source === out.target),
  )
  if (cyclicPeers.length > 0) {
    const peerNames = [...new Set(
      cyclicPeers.map(r => graph.entities.find(e => e.id === r.target)?.name).filter(Boolean),
    )].slice(0, 5)
    notes.push({
      text: `Bidirectional dependency with: ${peerNames.join(', ')}. Consider breaking the cycle.`,
      severity: 'warning',
    })
  }

  return notes
}

// ── See Also ─────────────────────────────────────────────────────────

function buildSeeAlso(
  entity: OntologyEntity,
  allRels: OntologyRelation[],
  graph: OntologyGraph,
): SeeAlsoEntry[] {
  const entries: SeeAlsoEntry[] = []
  const seen = new Set<string>()
  seen.add(entity.id)

  for (const rel of allRels) {
    const otherId = rel.source === entity.id ? rel.target : rel.source
    if (seen.has(otherId)) continue
    seen.add(otherId)

    const other = graph.entities.find(e => e.id === otherId)
    if (!other) continue
    if (rel.type === 'contains') continue

    const direction = rel.source === entity.id ? '→' : '←'
    entries.push({
      entity: other,
      relation: `${direction} ${rel.type}`,
    })
  }

  return entries.slice(0, 20)
}

// ── Follow-up Questions ──────────────────────────────────────────────

function buildFollowUpQuestions(
  entity: OntologyEntity,
  inbound: OntologyRelation[],
  outbound: OntologyRelation[],
  graph: OntologyGraph,
): string[] {
  const questions: string[] = []

  if (inbound.filter(r => r.type === 'calls').length > 0) {
    questions.push(`What are all the callers of \`${entity.name}\` and what arguments do they pass?`)
  }

  if (outbound.filter(r => r.type === 'calls').length > 0) {
    questions.push(`What does \`${entity.name}\` call and what side effects does it produce?`)
  }

  if (entity.type === 'Class' || entity.type === 'Interface') {
    questions.push(`What is the inheritance hierarchy of \`${entity.name}\`?`)
  }

  if (entity.type === 'Function' || entity.type === 'Method') {
    questions.push(`What is the error handling strategy in \`${entity.name}\`?`)
  }

  const container = graph.relations
    .filter(r => r.type === 'contains' && r.target === entity.id)
    .map(r => graph.entities.find(e => e.id === r.source))
    .filter(Boolean)[0]

  if (container) {
    questions.push(`How does \`${entity.name}\` fit into the ${container.type.toLowerCase()} \`${container.name}\`?`)
  }

  questions.push(`What is the impact if \`${entity.name}\` is modified?`)

  return questions.slice(0, 5)
}
