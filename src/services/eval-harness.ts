/**
 * Evaluation harness (P3 — make "anti-hallucination" measurable).
 *
 * The CLI already runs the accuracy suite as binary pass/fail per case. This
 * module turns that into graded, quantitative metrics: per-case and per-category
 * precision / recall / F1 computed directly from the ontology graph, plus
 * regression detection against a saved baseline. It is pure (only depends on the
 * graph + a suite of expectations) so it runs in the renderer/CLI and is unit
 * testable — giving CodeWiki a regression-gated, comparable accuracy score
 * instead of a single all-or-nothing percentage.
 */

import type { OntologyEntity, OntologyGraph, OntologyRelationType } from '../types'

export type EvalCaseType =
  | 'entity_extraction'
  | 'relation_detection'
  | 'callers'
  | 'callees'
  | 'impact_analysis'
  | 'find_references'

export interface EvalCase {
  name: string
  type: EvalCaseType
  // entity_extraction
  expected_entities?: Array<{ name: string; type: string; file?: string }>
  // relation_detection
  expected_relations?: Array<{ source: string; target: string; type: string }>
  // callers / callees / find_references / impact_analysis
  entity?: string
  modify_entity?: string
  expected_callers?: string[]
  expected_callees?: string[]
  expected_ref_files?: string[]
  expected_impacted?: string[]
  not_impacted?: string[]
}

export interface CaseMetric {
  name: string
  type: EvalCaseType
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
  /** Binary pass (full recall + no false positives), for parity with the CLI. */
  passed: boolean
  missing: string[]
  unexpected: string[]
}

export interface CategoryMetric {
  type: EvalCaseType | 'overall'
  cases: number
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
  /** Mean of per-case F1 (macro), complements the micro F1 above. */
  macroF1: number
}

export interface EvalReport {
  categories: Record<string, CategoryMetric>
  overall: CategoryMetric
  cases: CaseMetric[]
}

const TRAVERSAL_RELATIONS: OntologyRelationType[] = [
  'calls', 'uses', 'imports', 'extends', 'implements', 'dependsOn', 'overrides',
]

const f1 = (p: number, r: number) => (p + r === 0 ? 0 : (2 * p * r) / (p + r))

function prf(tp: number, fp: number, fn: number): { precision: number; recall: number; f1: number } {
  const precision = tp + fp === 0 ? (fn === 0 ? 1 : 0) : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  return { precision, recall, f1: f1(precision, recall) }
}

/** Compare an expected set against an actual set (order-insensitive). */
function setMetric(name: string, type: EvalCaseType, expected: string[], actual: string[]): CaseMetric {
  const exp = new Set(expected)
  const act = new Set(actual)
  const missing = [...exp].filter(x => !act.has(x))
  const unexpected = [...act].filter(x => !exp.has(x))
  const tp = exp.size - missing.length
  const fn = missing.length
  const fp = unexpected.length
  const { precision, recall, f1: score } = prf(tp, fp, fn)
  return {
    name, type, tp, fp, fn, precision, recall, f1: score,
    passed: fn === 0 && fp === 0, missing, unexpected,
  }
}

class GraphQuery {
  private byName = new Map<string, OntologyEntity[]>()
  private byId = new Map<string, OntologyEntity>()
  constructor(private graph: OntologyGraph) {
    for (const e of graph.entities) {
      this.byId.set(e.id, e)
      const arr = this.byName.get(e.name)
      if (arr) arr.push(e)
      else this.byName.set(e.name, [e])
    }
  }
  entity(name: string): OntologyEntity | undefined { return this.byName.get(name)?.[0] }
  name(id: string): string | undefined { return this.byId.get(id)?.name }

  /** Entities that call the given entity (incoming `calls`). */
  callers(name: string): string[] {
    const e = this.entity(name); if (!e) return []
    return this.graph.relations
      .filter(r => r.type === 'calls' && r.target === e.id)
      .map(r => this.name(r.source)).filter((n): n is string => !!n)
  }
  /** Entities the given entity calls (outgoing `calls`). */
  callees(name: string): string[] {
    const e = this.entity(name); if (!e) return []
    return this.graph.relations
      .filter(r => r.type === 'calls' && r.source === e.id)
      .map(r => this.name(r.target)).filter((n): n is string => !!n)
  }
  /** Files that reference the given entity (incoming traversal relations). */
  refFiles(name: string): string[] {
    const e = this.entity(name); if (!e) return []
    const files = new Set<string>()
    for (const r of this.graph.relations) {
      if (r.target !== e.id) continue
      if (!TRAVERSAL_RELATIONS.includes(r.type)) continue
      const src = this.byId.get(r.source)
      if (src) files.add(src.filePath.split(/[/\\]/).pop() || src.filePath)
    }
    return [...files]
  }
  /** Reverse-dependency closure: everything affected if `name` changes. */
  impactedBy(name: string): string[] {
    const e = this.entity(name); if (!e) return []
    const affected = new Set<string>()
    const stack = [e.id]
    while (stack.length) {
      const id = stack.pop()!
      for (const r of this.graph.relations) {
        if (r.target !== id || !TRAVERSAL_RELATIONS.includes(r.type)) continue
        if (!affected.has(r.source)) { affected.add(r.source); stack.push(r.source) }
      }
    }
    return [...affected].map(id => this.name(id)).filter((n): n is string => !!n && n !== name)
  }
}

/** Evaluate a single case against the graph, returning graded metrics. */
export function evaluateCase(tc: EvalCase, graph: OntologyGraph, q?: GraphQuery): CaseMetric {
  const query = q ?? new GraphQuery(graph)
  switch (tc.type) {
    case 'entity_extraction': {
      const expected = (tc.expected_entities ?? []).map(e => `${e.type.toLowerCase()}:${e.name}`)
      const actual = graph.entities.map(e => `${e.type.toLowerCase()}:${e.name}`)
      // Only count actuals that were expected for fp control on this scoped case.
      const expSet = new Set(expected)
      const scopedActual = actual.filter(a => expSet.has(a))
      return setMetric(tc.name, tc.type, expected, scopedActual)
    }
    case 'relation_detection': {
      const key = (s: string, t: string, ty: string) => `${s}->${t}:${ty}`
      const expected = (tc.expected_relations ?? []).map(r => key(r.source, r.target, r.type))
      const actualAll = graph.relations.map(r =>
        key(query.name(r.source) ?? r.source, query.name(r.target) ?? r.target, r.type))
      const expSet = new Set(expected)
      return setMetric(tc.name, tc.type, expected, actualAll.filter(a => expSet.has(a)))
    }
    case 'callers':
      return setMetric(tc.name, tc.type, tc.expected_callers ?? [], query.callers(tc.entity ?? ''))
    case 'callees':
      return setMetric(tc.name, tc.type, tc.expected_callees ?? [], query.callees(tc.entity ?? ''))
    case 'find_references':
      return setMetric(tc.name, tc.type, tc.expected_ref_files ?? [], query.refFiles(tc.entity ?? ''))
    case 'impact_analysis': {
      const impacted = query.impactedBy(tc.modify_entity ?? tc.entity ?? '')
      const impactedSet = new Set(impacted)
      const base = setMetric(tc.name, tc.type, tc.expected_impacted ?? [], impacted.filter(n => (tc.expected_impacted ?? []).includes(n) || (tc.not_impacted ?? []).includes(n)))
      // not_impacted entries that show up are false positives.
      const violations = (tc.not_impacted ?? []).filter(n => impactedSet.has(n))
      base.fp += violations.length
      base.unexpected.push(...violations)
      const m = prf(base.tp, base.fp, base.fn)
      return { ...base, ...m, passed: base.fn === 0 && base.fp === 0 }
    }
    default:
      return { name: tc.name, type: tc.type, tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0, passed: false, missing: [], unexpected: [] }
  }
}

function aggregate(type: CategoryMetric['type'], cases: CaseMetric[]): CategoryMetric {
  const tp = cases.reduce((s, c) => s + c.tp, 0)
  const fp = cases.reduce((s, c) => s + c.fp, 0)
  const fn = cases.reduce((s, c) => s + c.fn, 0)
  const { precision, recall, f1: micro } = prf(tp, fp, fn)
  const macroF1 = cases.length ? cases.reduce((s, c) => s + c.f1, 0) / cases.length : 0
  return { type, cases: cases.length, tp, fp, fn, precision, recall, f1: micro, macroF1 }
}

/** Run a full suite and produce graded per-category + overall metrics. */
export function runEval(graph: OntologyGraph, cases: EvalCase[]): EvalReport {
  const q = new GraphQuery(graph)
  const caseMetrics = cases.map(tc => evaluateCase(tc, graph, q))
  const categories: Record<string, CategoryMetric> = {}
  const byType = new Map<EvalCaseType, CaseMetric[]>()
  for (const c of caseMetrics) {
    const arr = byType.get(c.type)
    if (arr) arr.push(c)
    else byType.set(c.type, [c])
  }
  for (const [type, list] of byType) categories[type] = aggregate(type, list)
  return { categories, overall: aggregate('overall', caseMetrics), cases: caseMetrics }
}

export interface Regression {
  category: string
  baselineF1: number
  currentF1: number
  delta: number
}

/**
 * Compare a report's per-category (and overall) micro-F1 to a baseline.
 * A category regresses when F1 drops by more than `epsilon` (default 0.01).
 */
export function compareToBaseline(
  report: EvalReport,
  baseline: Record<string, number>,
  epsilon = 0.01,
): { regressions: Regression[]; improved: Regression[] } {
  const regressions: Regression[] = []
  const improved: Regression[] = []
  const current: Record<string, number> = { overall: report.overall.f1 }
  for (const [k, v] of Object.entries(report.categories)) current[k] = v.f1
  for (const [category, currentF1] of Object.entries(current)) {
    if (!(category in baseline)) continue
    const delta = currentF1 - baseline[category]
    if (delta < -epsilon) regressions.push({ category, baselineF1: baseline[category], currentF1, delta })
    else if (delta > epsilon) improved.push({ category, baselineF1: baseline[category], currentF1, delta })
  }
  return { regressions, improved }
}

/** Flatten a report into a `{ category: f1 }` map suitable for saving as a baseline. */
export function toBaseline(report: EvalReport): Record<string, number> {
  const out: Record<string, number> = { overall: Number(report.overall.f1.toFixed(4)) }
  for (const [k, v] of Object.entries(report.categories)) out[k] = Number(v.f1.toFixed(4))
  return out
}
