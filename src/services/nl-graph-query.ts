/**
 * Natural Language → Graph Query
 *
 * Translates natural language questions about code into
 * structured graph queries and returns precise results.
 *
 * Examples:
 *   "Which functions call UserService?" → find callers of UserService
 *   "What depends on auth.ts?" → find file dependents
 *   "Show me all classes in the services folder" → filter by type+path
 *
 * Pure functions — query string + ontology graph in → results out.
 */

import type { OntologyGraph, OntologyEntity, OntologyRelation } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────

export interface NLQueryResult {
  intent: QueryIntent
  entities: OntologyEntity[]
  relations: OntologyRelation[]
  explanation: string
}

export type QueryIntent =
  | 'find_callers'     // "what calls X?"
  | 'find_callees'     // "what does X call?"
  | 'find_by_type'     // "show all classes/functions/..."
  | 'find_by_file'     // "entities in file X"
  | 'find_dependents'  // "what depends on X?"
  | 'find_dependencies'// "what does X depend on?"
  | 'find_by_name'     // "find entity named X"
  | 'find_isolated'    // "isolated entities"
  | 'find_hub'         // "most connected entities"
  | 'unknown'

interface ParsedQuery {
  intent: QueryIntent
  target?: string
  entityType?: string
}

// ── Intent detection ──────────────────────────────────────────────────────

const PATTERNS: Array<{ pattern: RegExp; intent: QueryIntent; targetGroup?: number }> = [
  // Callers
  { pattern: /(?:what|which|who)\s+(?:calls?|invokes?|uses?)\s+(.+)/i, intent: 'find_callers', targetGroup: 1 },
  { pattern: /callers?\s+of\s+(.+)/i, intent: 'find_callers', targetGroup: 1 },
  { pattern: /谁调用了?\s*(.+)/i, intent: 'find_callers', targetGroup: 1 },
  { pattern: /(.+)\s*的调用者/i, intent: 'find_callers', targetGroup: 1 },
  // Callees
  { pattern: /what\s+does\s+(.+?)\s+call/i, intent: 'find_callees', targetGroup: 1 },
  { pattern: /(.+?)\s+calls?\s+what/i, intent: 'find_callees', targetGroup: 1 },
  { pattern: /(.+)\s*调用了什么/i, intent: 'find_callees', targetGroup: 1 },
  // Dependents
  { pattern: /(?:what|which)\s+depends?\s+on\s+(.+)/i, intent: 'find_dependents', targetGroup: 1 },
  { pattern: /dependents?\s+of\s+(.+)/i, intent: 'find_dependents', targetGroup: 1 },
  { pattern: /依赖\s*(.+)\s*的/i, intent: 'find_dependents', targetGroup: 1 },
  // Dependencies
  { pattern: /(?:what|which)\s+does\s+(.+?)\s+depend\s+on/i, intent: 'find_dependencies', targetGroup: 1 },
  { pattern: /dependencies?\s+of\s+(.+)/i, intent: 'find_dependencies', targetGroup: 1 },
  { pattern: /(.+)\s*依赖什么/i, intent: 'find_dependencies', targetGroup: 1 },
  // By type
  { pattern: /(?:show|list|find)\s+(?:all\s+)?(class(?:es)?|function(?:s)?|interface(?:s)?|component(?:s)?|type(?:s)?|hook(?:s)?)/i, intent: 'find_by_type', targetGroup: 1 },
  { pattern: /所有的?\s*(类|函数|接口|组件|类型)/i, intent: 'find_by_type', targetGroup: 1 },
  // By file
  { pattern: /(?:entities?|code)\s+in\s+(?:file\s+)?(.+)/i, intent: 'find_by_file', targetGroup: 1 },
  { pattern: /(.+)\s*(?:文件|里面)的?(?:实体|代码)/i, intent: 'find_by_file', targetGroup: 1 },
  // Isolated
  { pattern: /isolated|orphan|unused|没有被?使用|孤立/i, intent: 'find_isolated' },
  // Hub / most connected
  { pattern: /(?:most\s+)?(?:connected|central|important|hub)|最重要|核心|耦合最高/i, intent: 'find_hub' },
  // By name (fallback)
  { pattern: /(?:find|show|where\s+is)\s+(.+)/i, intent: 'find_by_name', targetGroup: 1 },
  { pattern: /查找\s*(.+)/i, intent: 'find_by_name', targetGroup: 1 },
]

const TYPE_MAP: Record<string, string> = {
  class: 'Class', classes: 'Class',
  function: 'Function', functions: 'Function',
  interface: 'Interface', interfaces: 'Interface',
  component: 'Component', components: 'Component',
  type: 'TypeAlias', types: 'TypeAlias',
  hook: 'Hook', hooks: 'Hook',
  '类': 'Class', '函数': 'Function', '接口': 'Interface', '组件': 'Component', '类型': 'TypeAlias',
}

function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trim().replace(/[?？。.!！]+$/, '')

  for (const { pattern, intent, targetGroup } of PATTERNS) {
    const match = pattern.exec(trimmed)
    if (match) {
      const target = targetGroup ? match[targetGroup]?.trim() : undefined
      const entityType = intent === 'find_by_type' && target ? TYPE_MAP[target.toLowerCase()] : undefined
      return { intent, target: entityType ? undefined : target, entityType }
    }
  }

  return { intent: 'find_by_name', target: trimmed }
}

// ── Query execution ───────────────────────────────────────────────────────

export function executeNLQuery(
  query: string,
  graph: OntologyGraph,
): NLQueryResult {
  const parsed = parseQuery(query)
  const entityById = new Map(graph.entities.map(e => [e.id, e]))

  switch (parsed.intent) {
    case 'find_callers': {
      const target = findEntity(parsed.target || '', graph)
      if (!target) return noResult(parsed.intent, `Entity "${parsed.target}" not found`)
      const callers = graph.relations
        .filter(r => r.target === target.id)
        .map(r => entityById.get(r.source))
        .filter((e): e is OntologyEntity => !!e)
      const rels = graph.relations.filter(r => r.target === target.id)
      return {
        intent: parsed.intent,
        entities: callers,
        relations: rels,
        explanation: `Found ${callers.length} callers of ${target.name} (${target.type})`,
      }
    }

    case 'find_callees': {
      const target = findEntity(parsed.target || '', graph)
      if (!target) return noResult(parsed.intent, `Entity "${parsed.target}" not found`)
      const callees = graph.relations
        .filter(r => r.source === target.id)
        .map(r => entityById.get(r.target))
        .filter((e): e is OntologyEntity => !!e)
      const rels = graph.relations.filter(r => r.source === target.id)
      return {
        intent: parsed.intent,
        entities: callees,
        relations: rels,
        explanation: `${target.name} calls/uses ${callees.length} entities`,
      }
    }

    case 'find_dependents': {
      const target = findEntity(parsed.target || '', graph)
      if (!target) return noResult(parsed.intent, `Entity "${parsed.target}" not found`)
      const deps = graph.relations
        .filter(r => r.target === target.id)
        .map(r => entityById.get(r.source))
        .filter((e): e is OntologyEntity => !!e)
      return {
        intent: parsed.intent,
        entities: deps,
        relations: graph.relations.filter(r => r.target === target.id),
        explanation: `${deps.length} entities depend on ${target.name}`,
      }
    }

    case 'find_dependencies': {
      const target = findEntity(parsed.target || '', graph)
      if (!target) return noResult(parsed.intent, `Entity "${parsed.target}" not found`)
      const deps = graph.relations
        .filter(r => r.source === target.id)
        .map(r => entityById.get(r.target))
        .filter((e): e is OntologyEntity => !!e)
      return {
        intent: parsed.intent,
        entities: deps,
        relations: graph.relations.filter(r => r.source === target.id),
        explanation: `${target.name} depends on ${deps.length} entities`,
      }
    }

    case 'find_by_type': {
      const typeFilter = parsed.entityType || ''
      const matches = graph.entities.filter(e =>
        e.type.toLowerCase() === typeFilter.toLowerCase(),
      )
      return {
        intent: parsed.intent,
        entities: matches,
        relations: [],
        explanation: `Found ${matches.length} ${typeFilter} entities`,
      }
    }

    case 'find_by_file': {
      const filePart = parsed.target || ''
      const matches = graph.entities.filter(e =>
        e.filePath.includes(filePart) || e.filePath.endsWith(filePart),
      )
      return {
        intent: parsed.intent,
        entities: matches,
        relations: [],
        explanation: `Found ${matches.length} entities in files matching "${filePart}"`,
      }
    }

    case 'find_isolated': {
      const connected = new Set<string>()
      for (const r of graph.relations) {
        connected.add(r.source)
        connected.add(r.target)
      }
      const isolated = graph.entities.filter(e => !connected.has(e.id))
      return {
        intent: parsed.intent,
        entities: isolated,
        relations: [],
        explanation: `Found ${isolated.length} isolated entities (no connections)`,
      }
    }

    case 'find_hub': {
      const degree = new Map<string, number>()
      for (const r of graph.relations) {
        degree.set(r.source, (degree.get(r.source) || 0) + 1)
        degree.set(r.target, (degree.get(r.target) || 0) + 1)
      }
      const sorted = graph.entities
        .map(e => ({ entity: e, deg: degree.get(e.id) || 0 }))
        .sort((a, b) => b.deg - a.deg)
        .slice(0, 20)
      return {
        intent: parsed.intent,
        entities: sorted.map(s => s.entity),
        relations: [],
        explanation: `Top ${sorted.length} most connected entities (by degree)`,
      }
    }

    case 'find_by_name': {
      const name = parsed.target || ''
      const matches = graph.entities.filter(e =>
        e.name.toLowerCase().includes(name.toLowerCase()),
      )
      return {
        intent: parsed.intent,
        entities: matches,
        relations: [],
        explanation: matches.length > 0
          ? `Found ${matches.length} entities matching "${name}"`
          : `No entities found matching "${name}"`,
      }
    }

    default:
      return noResult('unknown', 'Could not understand the query')
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function findEntity(name: string, graph: OntologyGraph): OntologyEntity | undefined {
  // Exact match first
  const exact = graph.entities.find(e => e.name === name)
  if (exact) return exact
  // Case-insensitive
  const lower = name.toLowerCase()
  return graph.entities.find(e => e.name.toLowerCase() === lower)
    || graph.entities.find(e => e.name.toLowerCase().includes(lower))
}

function noResult(intent: QueryIntent, explanation: string): NLQueryResult {
  return { intent, entities: [], relations: [], explanation }
}
