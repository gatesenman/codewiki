/**
 * PR Review Agent
 *
 * Analyses a git diff against the ontology graph to produce
 * impact-aware code review feedback.
 *
 * Core idea: instead of reviewing code as raw text (like generic
 * AI reviewers), we cross-reference the diff with the ontology to
 * find impacted entities, missing test updates, broken callers, etc.
 *
 * Pure functions — diff text + ontology graph in → review out.
 */

import type { OntologyGraph, OntologyEntity } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────

export interface DiffHunk {
  filePath: string
  addedLines: number
  removedLines: number
  changedEntityNames: string[]
}

export interface ReviewFinding {
  severity: 'critical' | 'warning' | 'info'
  category: string
  message: string
  file?: string
  entities?: string[]
}

export interface PRReviewResult {
  summary: string
  riskScore: number // 0-100
  findings: ReviewFinding[]
  impactedEntities: Array<{ name: string; type: string; file: string; reason: string }>
  stats: {
    filesChanged: number
    entitiesDirectlyChanged: number
    entitiesIndirectlyImpacted: number
    addedLines: number
    removedLines: number
  }
}

// ── Diff parser ───────────────────────────────────────────────────────────

/**
 * Parse a unified diff string into structured hunks.
 */
export function parseDiff(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let currentFile = ''
  let added = 0
  let removed = 0

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git')) {
      if (currentFile) {
        hunks.push({ filePath: currentFile, addedLines: added, removedLines: removed, changedEntityNames: [] })
      }
      const match = /b\/(.+)$/.exec(line)
      currentFile = match?.[1] || ''
      added = 0
      removed = 0
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++
    }
  }
  if (currentFile) {
    hunks.push({ filePath: currentFile, addedLines: added, removedLines: removed, changedEntityNames: [] })
  }

  return hunks
}

// ── Entity impact analysis ────────────────────────────────────────────────

/**
 * Find entities that are directly modified by the diff (in changed files).
 */
export function findDirectlyChangedEntities(
  hunks: DiffHunk[],
  graph: OntologyGraph,
): OntologyEntity[] {
  const changedFiles = new Set(hunks.map(h => h.filePath))
  return graph.entities.filter(e =>
    changedFiles.has(e.filePath) ||
    [...changedFiles].some(f => e.filePath.endsWith(f)),
  )
}

/**
 * Find entities that are indirectly impacted (callers/dependents of changed entities).
 */
export function findIndirectlyImpacted(
  directEntities: OntologyEntity[],
  graph: OntologyGraph,
  maxHops: number = 2,
): OntologyEntity[] {
  const directIds = new Set(directEntities.map(e => e.id))
  const impacted = new Map<string, OntologyEntity>()
  const entityById = new Map(graph.entities.map(e => [e.id, e]))

  let frontier = new Set(directIds)
  const visited = new Set(directIds)

  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Set<string>()
    for (const id of frontier) {
      // Find entities that DEPEND ON this entity (reverse direction = callers)
      for (const r of graph.relations) {
        if (r.target === id && !visited.has(r.source)) {
          visited.add(r.source)
          next.add(r.source)
          const e = entityById.get(r.source)
          if (e && !directIds.has(e.id)) {
            impacted.set(e.id, e)
          }
        }
      }
    }
    frontier = next
  }

  return [...impacted.values()]
}

// ── Review generation ─────────────────────────────────────────────────────

/**
 * Generate a PR review from a diff and ontology graph.
 */
export function reviewDiff(
  diffText: string,
  graph: OntologyGraph,
): PRReviewResult {
  const hunks = parseDiff(diffText)
  const directEntities = findDirectlyChangedEntities(hunks, graph)
  const indirectEntities = findIndirectlyImpacted(directEntities, graph)
  const findings: ReviewFinding[] = []

  const totalAdded = hunks.reduce((s, h) => s + h.addedLines, 0)
  const totalRemoved = hunks.reduce((s, h) => s + h.removedLines, 0)

  // 1. Large file changes
  for (const h of hunks) {
    if (h.addedLines + h.removedLines > 200) {
      findings.push({
        severity: 'warning',
        category: 'size',
        message: `Large change in ${h.filePath}: +${h.addedLines}/-${h.removedLines} lines. Consider splitting.`,
        file: h.filePath,
      })
    }
  }

  // 2. High-impact entities (many dependents)
  const inDegree = new Map<string, number>()
  for (const r of graph.relations) {
    inDegree.set(r.target, (inDegree.get(r.target) || 0) + 1)
  }

  for (const e of directEntities) {
    const deg = inDegree.get(e.id) || 0
    if (deg >= 5) {
      findings.push({
        severity: 'critical',
        category: 'high-impact',
        message: `${e.name} (${e.type}) has ${deg} dependents. Changes may cascade widely.`,
        file: e.filePath,
        entities: [e.name],
      })
    }
  }

  // 3. Unupdated dependents
  const changedFiles = new Set(hunks.map(h => h.filePath))
  const uncheckdDeps = indirectEntities.filter(e =>
    !changedFiles.has(e.filePath) &&
    ![...changedFiles].some(f => e.filePath.endsWith(f)),
  )
  if (uncheckdDeps.length > 0) {
    findings.push({
      severity: 'warning',
      category: 'missing-updates',
      message: `${uncheckdDeps.length} dependent entities in unchanged files may need updating.`,
      entities: uncheckdDeps.slice(0, 10).map(e => e.name),
    })
  }

  // 4. Test file detection
  const hasTestChanges = hunks.some(h =>
    h.filePath.includes('test') || h.filePath.includes('spec') || h.filePath.includes('__tests__'),
  )
  if (!hasTestChanges && directEntities.length > 0) {
    findings.push({
      severity: 'info',
      category: 'tests',
      message: 'No test files changed. Consider adding/updating tests for modified entities.',
    })
  }

  // Risk score: 0-100
  let riskScore = 0
  riskScore += Math.min(30, hunks.length * 5) // files changed
  riskScore += Math.min(20, directEntities.length * 2) // entities changed
  riskScore += Math.min(30, indirectEntities.length * 3) // impact radius
  riskScore += findings.filter(f => f.severity === 'critical').length * 10
  riskScore = Math.min(100, riskScore)

  // Summary
  const riskLevel = riskScore < 25 ? 'Low' : riskScore < 50 ? 'Medium' : riskScore < 75 ? 'High' : 'Critical'
  const summary = `${riskLevel} risk (${riskScore}/100). ${hunks.length} files changed, ${directEntities.length} entities directly modified, ${indirectEntities.length} indirectly impacted.`

  return {
    summary,
    riskScore,
    findings,
    impactedEntities: [
      ...directEntities.map(e => ({ name: e.name, type: e.type, file: e.filePath, reason: 'directly changed' })),
      ...indirectEntities.slice(0, 20).map(e => ({ name: e.name, type: e.type, file: e.filePath, reason: 'indirectly impacted (dependent)' })),
    ],
    stats: {
      filesChanged: hunks.length,
      entitiesDirectlyChanged: directEntities.length,
      entitiesIndirectlyImpacted: indirectEntities.length,
      addedLines: totalAdded,
      removedLines: totalRemoved,
    },
  }
}
