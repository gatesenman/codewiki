/**
 * LSIF consumer (P0-3).
 *
 * Consumes an LSIF dump (JSONL graph, as produced by `lsif-node`,
 * `scip-typescript --output dump.lsif`, etc.) and turns it into
 * compiler-accurate definition/reference relations that are merged into the
 * ontology graph.
 *
 * Why: the ontology is built from regex/AST heuristics, which under-report
 * cross-file usage (re-exports, aliased imports, overloads, generics). An LSIF
 * index is produced by the real compiler, so consuming it upgrades the
 * "approximate" graph toward a "precise" one — without changing how the graph
 * is built when no index is present (zero cost, opt-in by file presence).
 *
 * Only the textual LSIF (JSONL) format is parsed here. SCIP is a binary
 * protobuf and is intentionally left to a dedicated decoder; `lsif_status`
 * still advertises how to generate either.
 */

import type { OntologyEntity, OntologyGraph, OntologyRelationType } from '../types'

/** A 0-based source location, mirroring LSIF range coordinates. */
export interface LsifOccurrence {
  file: string // absolute file path (decoded from the document URI)
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

/** All definition/reference occurrences for a single symbol. */
export interface LsifSymbol {
  /** Stable key for the symbol (moniker identifier when available). */
  key: string
  moniker?: string
  definitions: LsifOccurrence[]
  references: LsifOccurrence[]
}

export interface LsifParseResult {
  symbols: LsifSymbol[]
  documentCount: number
  rangeCount: number
}

interface RangeVertex {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

/** Convert a `file://` URI (or a plain path) to an absolute filesystem path. */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  let p = uri.slice('file://'.length)
  // file:///C:/x on Windows -> /C:/x ; strip the leading slash before a drive
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

/**
 * Parse an LSIF JSONL dump into per-symbol definition/reference occurrences.
 * Unknown lines are ignored so partial / vendor-extended dumps still parse.
 */
export function parseLsif(text: string): LsifParseResult {
  const documents = new Map<number, string>() // id -> uri
  const ranges = new Map<number, RangeVertex>() // id -> range
  const monikers = new Map<number, string>() // id -> identifier

  // range/resultSet id -> resultSet id (root of the `next` chain)
  const nextEdge = new Map<number, number>()
  // resultSet id -> moniker id
  const resultSetMoniker = new Map<number, number>()
  // definitionResult / referenceResult id -> owning resultSet id
  const resultOwner = new Map<number, number>()
  const refResultIds = new Set<number>()
  const defResultIds = new Set<number>()

  // item edges are emitted after the result vertices, so collect raw then resolve.
  interface ItemEdge { outV: number; inVs: number[]; document: number; property?: string }
  const items: ItemEdge[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    let el: Record<string, unknown>
    try {
      el = JSON.parse(line)
    } catch {
      continue
    }
    const label = el.label as string | undefined
    if (el.type === 'vertex') {
      const id = el.id as number
      switch (label) {
        case 'document':
          documents.set(id, el.uri as string)
          break
        case 'range':
          ranges.set(id, { start: (el as { start: RangeVertex['start'] }).start, end: (el as { end: RangeVertex['end'] }).end })
          break
        case 'moniker':
          monikers.set(id, (el.identifier as string) || (el.id as number).toString())
          break
        case 'referenceResult':
          refResultIds.add(id)
          break
        case 'definitionResult':
          defResultIds.add(id)
          break
        default:
          break
      }
    } else if (el.type === 'edge') {
      switch (label) {
        case 'next':
          nextEdge.set(el.outV as number, el.inV as number)
          break
        case 'moniker':
          resultSetMoniker.set(el.outV as number, el.inV as number)
          break
        case 'textDocument/definition':
          resultOwner.set(el.inV as number, el.outV as number)
          defResultIds.add(el.inV as number)
          break
        case 'textDocument/references':
          resultOwner.set(el.inV as number, el.outV as number)
          refResultIds.add(el.inV as number)
          break
        case 'item':
          items.push({
            outV: el.outV as number,
            inVs: (el.inVs as number[]) || [],
            document: el.document as number,
            property: el.property as string | undefined,
          })
          break
        default:
          break
      }
    }
  }

  // Follow a `next` chain (range -> resultSet -> resultSet) to its root.
  const resolveRoot = (id: number): number => {
    let cur = id
    const seen = new Set<number>()
    while (nextEdge.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = nextEdge.get(cur)!
    }
    return cur
  }

  const symbols = new Map<number, LsifSymbol>() // root resultSet id -> symbol
  const symbolFor = (rootId: number): LsifSymbol => {
    let s = symbols.get(rootId)
    if (!s) {
      const monId = resultSetMoniker.get(rootId)
      const moniker = monId !== undefined ? monikers.get(monId) : undefined
      s = { key: moniker ?? `rs:${rootId}`, moniker, definitions: [], references: [] }
      symbols.set(rootId, s)
    }
    return s
  }

  for (const item of items) {
    const ownerResultSet = resultOwner.get(item.outV)
    if (ownerResultSet === undefined) continue
    const root = resolveRoot(ownerResultSet)
    const sym = symbolFor(root)
    const uri = documents.get(item.document)
    if (!uri) continue
    const file = uriToPath(uri)
    const isReference = item.property === 'references' || refResultIds.has(item.outV)
    for (const rid of item.inVs) {
      const r = ranges.get(rid)
      if (!r) continue
      const occ: LsifOccurrence = {
        file,
        startLine: r.start.line,
        startChar: r.start.character,
        endLine: r.end.line,
        endChar: r.end.character,
      }
      if (isReference && item.property !== 'definitions') sym.references.push(occ)
      else sym.definitions.push(occ)
    }
  }

  return {
    symbols: Array.from(symbols.values()).filter(s => s.definitions.length || s.references.length),
    documentCount: documents.size,
    rangeCount: ranges.size,
  }
}

export interface LsifMergeStats {
  added: number
  symbolsMatched: number
}

/**
 * Merge LSIF symbols into an ontology graph as precise `calls`/`uses`
 * relations. Each reference is mapped to its innermost enclosing entity and
 * linked to the entity that owns the symbol's definition. Existing relations
 * are never duplicated.
 *
 * Mutates `graph.relations` in place and returns how much was added.
 */
export function mergeLsifIntoGraph(graph: OntologyGraph, symbols: LsifSymbol[]): LsifMergeStats {
  // Index entities by absolute file path for fast enclosing lookups.
  const byFile = new Map<string, OntologyEntity[]>()
  for (const e of graph.entities) {
    const arr = byFile.get(e.filePath)
    if (arr) arr.push(e)
    else byFile.set(e.filePath, [e])
  }

  const containerRank: Record<string, number> = {
    Method: 5, Function: 5, Component: 4, Class: 3, Interface: 3, Enum: 3,
    Type: 2, Variable: 2, Module: 1, File: 0, Package: 0,
  }

  // Innermost entity whose [line, endLine] (1-based) contains the 0-based line.
  const enclosing = (file: string, line0: number): OntologyEntity | undefined => {
    const arr = byFile.get(file)
    if (!arr) return undefined
    const line = line0 + 1
    let best: OntologyEntity | undefined
    for (const e of arr) {
      if (e.line <= line && line <= e.endLine) {
        if (!best) { best = e; continue }
        // Prefer the tighter range; break ties by container rank (callable wins).
        const span = e.endLine - e.line
        const bestSpan = best.endLine - best.line
        if (span < bestSpan || (span === bestSpan && (containerRank[e.type] ?? 0) > (containerRank[best.type] ?? 0))) {
          best = e
        }
      }
    }
    return best
  }

  const existing = new Set(graph.relations.map(r => `${r.source}|${r.target}|${r.type}`))
  let added = 0
  let symbolsMatched = 0
  let counter = graph.relations.length

  for (const sym of symbols) {
    if (!sym.definitions.length || !sym.references.length) continue
    const defOcc = sym.definitions[0]
    const defEntity = enclosing(defOcc.file, defOcc.startLine)
    if (!defEntity) continue
    let matchedThisSymbol = false
    const callable = defEntity.type === 'Function' || defEntity.type === 'Method'
    const relType: OntologyRelationType = callable ? 'calls' : 'uses'

    for (const ref of sym.references) {
      const refEntity = enclosing(ref.file, ref.startLine)
      if (!refEntity || refEntity.id === defEntity.id) continue
      const key = `${refEntity.id}|${defEntity.id}|${relType}`
      if (existing.has(key)) continue
      existing.add(key)
      graph.relations.push({
        id: `lsif_rel_${counter++}`,
        source: refEntity.id,
        target: defEntity.id,
        type: relType,
        metadata: { source: 'lsif', symbol: sym.key },
      })
      added++
      matchedThisSymbol = true
    }
    if (matchedThisSymbol) symbolsMatched++
  }

  return { added, symbolsMatched }
}

/** Candidate LSIF dump file names, checked in order, relative to a project root. */
export const LSIF_CANDIDATES = ['dump.lsif', 'index.lsif', '.codewiki/dump.lsif', '.codewiki/index.lsif']
