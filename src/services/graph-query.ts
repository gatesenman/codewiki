/**
 * Natural-language → ontology graph query.
 *
 * Translates plain-text questions (EN + ZH) into structured intents and
 * executes them against the OntologyGraph — no LLM required.  Supports
 * callers/callees, references, impact, dependencies, entity lookup, path
 * finding, and neighbor queries.
 *
 * Pure (graph in → result out), fully testable offline.
 */

import type {
  OntologyEntity,
  OntologyGraph,
  OntologyRelation,
  OntologyEntityType,
} from '../types'

// ---- Intent types -------------------------------------------------------

export type QueryOp =
  | 'callers'
  | 'callees'
  | 'references'
  | 'impact'
  | 'dependencies'
  | 'find'
  | 'path'
  | 'neighbors'

export interface QueryIntent {
  op: QueryOp
  /** Primary entity name (or pattern). */
  target: string
  /** Secondary entity for path queries. */
  target2?: string
  /** Entity type filter for find queries. */
  entityType?: OntologyEntityType
  /** Maximum traversal depth. */
  depth?: number
}

export interface QueryResult {
  intent: QueryIntent
  entities: OntologyEntity[]
  relations: OntologyRelation[]
  summary: string
}

// ---- Entity resolution ---------------------------------------------------

function findEntities(graph: OntologyGraph, name: string): OntologyEntity[] {
  const lower = name.toLowerCase()
  // Exact name match first (case-insensitive)
  const exact = graph.entities.filter(e => e.name.toLowerCase() === lower)
  if (exact.length) return exact
  // Substring / partial
  return graph.entities.filter(
    e => e.name.toLowerCase().includes(lower) || lower.includes(e.name.toLowerCase()),
  )
}

// ---- Query patterns ------------------------------------------------------

// Each pattern: [regex, extractor].  First match wins.  The regexes work on the
// lowercased, trimmed query string.

type Extractor = (m: RegExpMatchArray) => QueryIntent

const TYPE_MAP: Record<string, OntologyEntityType> = {
  class: 'Class', classes: 'Class',
  interface: 'Interface', interfaces: 'Interface',
  function: 'Function', functions: 'Function',
  method: 'Method', methods: 'Method',
  variable: 'Variable', variables: 'Variable',
  type: 'Type', types: 'Type',
  enum: 'Enum', enums: 'Enum',
  module: 'Module', modules: 'Module',
  file: 'File', files: 'File',
  component: 'Component', components: 'Component',
  package: 'Package', packages: 'Package',
  // Chinese
  '类': 'Class', '接口': 'Interface', '函数': 'Function',
  '方法': 'Method', '变量': 'Variable', '类型': 'Type',
  '枚举': 'Enum', '模块': 'Module', '文件': 'File',
  '组件': 'Component', '包': 'Package',
}

function typeFromWord(w: string): OntologyEntityType | undefined {
  return TYPE_MAP[w.toLowerCase()]
}

const PATTERNS: Array<[RegExp, Extractor]> = [
  // --- callers ---
  [/who\s+calls\s+['"`]?(\w+)['"`]?/i, m => ({ op: 'callers', target: m[1] })],
  [/callers?\s+(?:of\s+)?['"`]?(\w+)['"`]?/i, m => ({ op: 'callers', target: m[1] })],
  [/what\s+calls\s+['"`]?(\w+)['"`]?/i, m => ({ op: 'callers', target: m[1] })],
  [/['"`]?(\w+)['"`]?\s*(?:的)?(?:调用者|被谁调用|谁调用)/i, m => ({ op: 'callers', target: m[1] })],
  [/谁调用(?:了)?\s*['"`]?(\w+)['"`]?/i, m => ({ op: 'callers', target: m[1] })],

  // --- callees ---
  [/what\s+does\s+['"`]?(\w+)['"`]?\s+call/i, m => ({ op: 'callees', target: m[1] })],
  [/callees?\s+(?:of\s+)?['"`]?(\w+)['"`]?/i, m => ({ op: 'callees', target: m[1] })],
  [/['"`]?(\w+)['"`]?\s*(?:调用了什么|调用了哪些|的被调用)/i, m => ({ op: 'callees', target: m[1] })],

  // --- references ---
  [/(?:where|how)\s+is\s+['"`]?(\w+)['"`]?\s+(?:used|referenced)/i, m => ({ op: 'references', target: m[1] })],
  [/references?\s+(?:of|to|for)\s+['"`]?(\w+)['"`]?/i, m => ({ op: 'references', target: m[1] })],
  [/['"`]?(\w+)['"`]?\s*(?:的引用|在哪里被引用|在哪里使用|被引用)/i, m => ({ op: 'references', target: m[1] })],

  // --- impact ---
  [/(?:impact|blast\s*radius)\s+(?:of\s+(?:changing\s+)?)?['"`]?(\w+)['"`]?/i, m => ({ op: 'impact', target: m[1] })],
  [/what\s+(?:breaks|is\s+affected)\s+if\s+(?:i\s+)?(?:change|modify|delete|remove)\s+['"`]?(\w+)['"`]?/i, m => ({ op: 'impact', target: m[1] })],
  [/(?:修改|改|删除)\s*['"`]?(\w+)['"`]?\s*(?:的影响|会怎样|影响哪些)/i, m => ({ op: 'impact', target: m[1] })],
  [/['"`]?(\w+)['"`]?\s*(?:的爆炸半径|影响分析|的影响范围)/i, m => ({ op: 'impact', target: m[1] })],

  // --- dependencies ---
  [/(?:dependencies|deps)\s+(?:of\s+)?['"`]?(\w+)['"`]?/i, m => ({ op: 'dependencies', target: m[1] })],
  [/what\s+does\s+['"`]?(\w+)['"`]?\s+(?:depend|import|use)/i, m => ({ op: 'dependencies', target: m[1] })],
  [/['"`]?(\w+)['"`]?\s*(?:依赖什么|依赖了|的依赖|导入了什么)/i, m => ({ op: 'dependencies', target: m[1] })],

  // --- path ---
  [/path\s+(?:from\s+)?['"`]?(\w+)['"`]?\s+to\s+['"`]?(\w+)['"`]?/i, m => ({ op: 'path', target: m[1], target2: m[2] })],
  [/how\s+(?:does\s+)?['"`]?(\w+)['"`]?\s+(?:reach|connect|relate)\s+(?:to\s+)?['"`]?(\w+)['"`]?/i, m => ({ op: 'path', target: m[1], target2: m[2] })],
  [/['"`]?(\w+)['"`]?\s*(?:到|到达)\s*['"`]?(\w+)['"`]?\s*(?:的路径|怎么连)/i, m => ({ op: 'path', target: m[1], target2: m[2] })],
  [/从\s*['"`]?(\w+)['"`]?\s*到\s*['"`]?(\w+)['"`]?/i, m => ({ op: 'path', target: m[1], target2: m[2] })],

  // --- find (by type) ---
  [/(?:find|list|show|get)\s+(?:all\s+)?(\w+)/i, m => {
    const ty = typeFromWord(m[1])
    return ty ? { op: 'find', target: '*', entityType: ty } : { op: 'neighbors', target: m[1] }
  }],
  [/列出(?:所有)?\s*(\S+)/i, m => {
    const ty = typeFromWord(m[1])
    return ty ? { op: 'find', target: '*', entityType: ty } : { op: 'neighbors', target: m[1] }
  }],

  // --- neighbors (fallback for "show X" / "tell me about X") ---
  [/(?:show|describe|explain|about|tell\s+me\s+about)\s+['"`]?(\w+)['"`]?/i, m => ({ op: 'neighbors', target: m[1] })],
  [/['"`]?(\w+)['"`]?\s*(?:是什么|的信息|的详情)/i, m => ({ op: 'neighbors', target: m[1] })],
]

// ---- Parse ----------------------------------------------------------------

export function parseQuery(text: string): QueryIntent | null {
  const q = text.trim()
  for (const [re, extract] of PATTERNS) {
    const m = q.match(re)
    if (m) return extract(m)
  }
  return null
}

// ---- Execute --------------------------------------------------------------

const CALL_RELS = new Set(['calls', 'uses'])
const IMPACT_RELS = new Set(['calls', 'uses', 'imports', 'extends', 'implements', 'dependsOn', 'overrides'])

export function executeQuery(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  switch (intent.op) {
    case 'callers': return execCallers(graph, intent)
    case 'callees': return execCallees(graph, intent)
    case 'references': return execReferences(graph, intent)
    case 'impact': return execImpact(graph, intent)
    case 'dependencies': return execDependencies(graph, intent)
    case 'find': return execFind(graph, intent)
    case 'path': return execPath(graph, intent)
    case 'neighbors': return execNeighbors(graph, intent)
  }
}

function entityById(graph: OntologyGraph, id: string): OntologyEntity | undefined {
  return graph.entities.find(e => e.id === id)
}

// callers: entities that call/use target
function execCallers(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const targets = findEntities(graph, intent.target)
  const targetIds = new Set(targets.map(e => e.id))
  const rels = graph.relations.filter(r => targetIds.has(r.target) && CALL_RELS.has(r.type))
  const callerIds = new Set(rels.map(r => r.source))
  const entities = graph.entities.filter(e => callerIds.has(e.id))
  const names = entities.map(e => `${e.name} (${e.type})`).join(', ') || 'none found'
  return { intent, entities, relations: rels, summary: `Callers of ${intent.target}: ${names}` }
}

// callees: entities called by target
function execCallees(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const targets = findEntities(graph, intent.target)
  const targetIds = new Set(targets.map(e => e.id))
  const rels = graph.relations.filter(r => targetIds.has(r.source) && CALL_RELS.has(r.type))
  const calleeIds = new Set(rels.map(r => r.target))
  const entities = graph.entities.filter(e => calleeIds.has(e.id))
  const names = entities.map(e => `${e.name} (${e.type})`).join(', ') || 'none found'
  return { intent, entities, relations: rels, summary: `Callees of ${intent.target}: ${names}` }
}

// references: all relations pointing at target (any type)
function execReferences(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const targets = findEntities(graph, intent.target)
  const targetIds = new Set(targets.map(e => e.id))
  const rels = graph.relations.filter(r => targetIds.has(r.target) && r.type !== 'contains')
  const refIds = new Set(rels.map(r => r.source))
  const entities = graph.entities.filter(e => refIds.has(e.id))
  const files = [...new Set(entities.map(e => e.filePath))]
  return { intent, entities, relations: rels, summary: `${intent.target} is referenced by ${entities.length} entity(ies) across ${files.length} file(s)` }
}

// impact: BFS reverse traversal (who depends on target)
function execImpact(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const seeds = findEntities(graph, intent.target)
  const seedIds = new Set(seeds.map(e => e.id))
  const depth = intent.depth ?? 5
  const visited = new Set<string>()
  const queue: Array<{ id: string; d: number }> = seeds.map(e => ({ id: e.id, d: 0 }))
  const hitRels: OntologyRelation[] = []

  while (queue.length) {
    const cur = queue.shift()!
    if (visited.has(cur.id) || cur.d > depth) continue
    visited.add(cur.id)
    for (const r of graph.relations) {
      if (r.target === cur.id && IMPACT_RELS.has(r.type) && !visited.has(r.source)) {
        queue.push({ id: r.source, d: cur.d + 1 })
        hitRels.push(r)
      }
    }
  }
  for (const id of seedIds) visited.delete(id)
  const entities = graph.entities.filter(e => visited.has(e.id))
  return { intent, entities, relations: hitRels, summary: `Changing ${intent.target} may impact ${entities.length} downstream entity(ies) (depth ${depth})` }
}

// dependencies: what target depends on (forward traversal)
function execDependencies(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const targets = findEntities(graph, intent.target)
  const targetIds = new Set(targets.map(e => e.id))
  const rels = graph.relations.filter(r => targetIds.has(r.source) && r.type !== 'contains')
  const depIds = new Set(rels.map(r => r.target))
  const entities = graph.entities.filter(e => depIds.has(e.id))
  const names = entities.map(e => `${e.name} (${e.type})`).join(', ') || 'none found'
  return { intent, entities, relations: rels, summary: `${intent.target} depends on: ${names}` }
}

// find: list all entities of a given type
function execFind(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const entities = intent.entityType
    ? graph.entities.filter(e => e.type === intent.entityType)
    : graph.entities
  const names = entities.slice(0, 20).map(e => e.name).join(', ')
  const suffix = entities.length > 20 ? ` ... and ${entities.length - 20} more` : ''
  return { intent, entities, relations: [], summary: `Found ${entities.length} ${intent.entityType ?? 'entity'}(s): ${names}${suffix}` }
}

// path: BFS from source to dest (undirected edges)
function execPath(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const srcs = findEntities(graph, intent.target)
  const dsts = findEntities(graph, intent.target2 ?? '')
  if (!srcs.length || !dsts.length) {
    return { intent, entities: [], relations: [], summary: `Could not find entities for "${intent.target}" or "${intent.target2}"` }
  }
  const dstIds = new Set(dsts.map(e => e.id))
  const prev = new Map<string, { from: string; rel: OntologyRelation }>()
  const queue = srcs.map(e => e.id)
  const visited = new Set(queue)
  let found: string | null = null

  outer: while (queue.length && !found) {
    const cur = queue.shift()!
    for (const r of graph.relations) {
      let next: string | null = null
      if (r.source === cur) next = r.target
      else if (r.target === cur) next = r.source
      if (!next || visited.has(next)) continue
      visited.add(next)
      prev.set(next, { from: cur, rel: r })
      if (dstIds.has(next)) { found = next; break outer }
      queue.push(next)
    }
  }

  if (!found) {
    return { intent, entities: [], relations: [], summary: `No path found from ${intent.target} to ${intent.target2}` }
  }

  // Reconstruct path
  const pathRels: OntologyRelation[] = []
  const pathIds: string[] = [found]
  let cur = found
  while (prev.has(cur)) {
    const p = prev.get(cur)!
    pathRels.push(p.rel)
    pathIds.push(p.from)
    cur = p.from
  }
  pathIds.reverse()
  pathRels.reverse()
  const entities = pathIds.map(id => entityById(graph, id)).filter(Boolean) as OntologyEntity[]
  const names = entities.map(e => e.name).join(' → ')
  return { intent, entities, relations: pathRels, summary: `Path (${pathIds.length} hops): ${names}` }
}

// neighbors: entities directly connected to target
function execNeighbors(graph: OntologyGraph, intent: QueryIntent): QueryResult {
  const targets = findEntities(graph, intent.target)
  const targetIds = new Set(targets.map(e => e.id))
  const rels = graph.relations.filter(r => targetIds.has(r.source) || targetIds.has(r.target))
  const neighborIds = new Set<string>()
  for (const r of rels) {
    if (!targetIds.has(r.source)) neighborIds.add(r.source)
    if (!targetIds.has(r.target)) neighborIds.add(r.target)
  }
  const entities = graph.entities.filter(e => neighborIds.has(e.id))
  const target0 = targets[0]
  const header = target0 ? `${target0.name} (${target0.type} in ${target0.filePath}:${target0.line})` : intent.target
  return { intent, entities, relations: rels, summary: `${header} has ${entities.length} neighbor(s) via ${rels.length} relation(s)` }
}

// ---- Convenience: parse + execute in one call ----------------------------

export function answerQuery(graph: OntologyGraph, text: string): QueryResult | null {
  const intent = parseQuery(text)
  if (!intent) return null
  return executeQuery(graph, intent)
}
