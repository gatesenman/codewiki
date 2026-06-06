/**
 * Wiki incremental regeneration.
 *
 * Given a set of changed files, determines which wiki pages are affected and
 * need regeneration — rather than re-generating the entire wiki from scratch.
 *
 * Pure (graph + pages + changes in → affected page list out), no IO.
 */

import type { OntologyEntity, OntologyGraph, WikiPage } from '../types'

// ---- Types ---------------------------------------------------------------

export interface IncrementalPlan {
  /** Page IDs/slugs that must be regenerated. */
  affectedPages: AffectedPage[]
  /** Total pages in the wiki. */
  totalPages: number
  /** True when every page is affected (might as well do a full regen). */
  fullRegenRecommended: boolean
}

export interface AffectedPage {
  id: string
  slug: string
  title: string
  /** Why this page is affected. */
  reason: 'direct' | 'transitive'
  /** Changed files that link to this page. */
  changedSources: string[]
}

// ---- Helpers -------------------------------------------------------------

/** Normalize path separators for comparison. */
function norm(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Collect entities whose filePath matches any of the changed files. */
function changedEntities(
  graph: OntologyGraph,
  changedFiles: Set<string>,
): OntologyEntity[] {
  return graph.entities.filter(e => {
    const n = norm(e.filePath)
    for (const cf of changedFiles) {
      if (n === cf || n.endsWith('/' + cf) || cf.endsWith('/' + n)) return true
    }
    return false
  })
}

/**
 * Expand a set of entity IDs to include their direct dependents (entities that
 * call/use/import/extend/implement them).  Returns a new set with both the
 * seeds and their dependents.
 */
function expandDependents(
  graph: OntologyGraph,
  seedIds: Set<string>,
  depth = 1,
): Set<string> {
  const result = new Set(seedIds)
  let frontier = new Set(seedIds)
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>()
    for (const r of graph.relations) {
      if (frontier.has(r.target) && !result.has(r.source) && r.type !== 'contains') {
        next.add(r.source)
        result.add(r.source)
      }
    }
    if (!next.size) break
    frontier = next
  }
  return result
}

// ---- Core ----------------------------------------------------------------

/**
 * Compute which wiki pages need regeneration given a list of changed file
 * paths (relative or absolute — matching is flexible via suffix comparison).
 *
 * @param pages       Current wiki pages (with `fileSources` populated).
 * @param graph       Current ontology graph.
 * @param changedFiles Paths of files that changed (e.g. from git diff or fs watcher).
 * @param transitiveDepth How many hops of dependents to consider (default 1).
 */
export function computeIncrementalPlan(
  pages: WikiPage[],
  graph: OntologyGraph,
  changedFiles: string[],
  transitiveDepth = 1,
): IncrementalPlan {
  if (!changedFiles.length) {
    return { affectedPages: [], totalPages: pages.length, fullRegenRecommended: false }
  }

  const changedSet = new Set(changedFiles.map(norm))

  // 1. Direct match: pages whose fileSources overlap with changedFiles.
  const directPages = new Map<string, AffectedPage>()

  for (const page of pages) {
    const sources = page.fileSources ?? []
    const matched: string[] = []
    for (const src of sources) {
      const ns = norm(src)
      for (const cf of changedSet) {
        if (ns === cf || ns.endsWith('/' + cf) || cf.endsWith('/' + ns)) {
          matched.push(cf)
        }
      }
    }
    if (matched.length) {
      directPages.set(page.id, {
        id: page.id,
        slug: page.slug,
        title: page.title,
        reason: 'direct',
        changedSources: [...new Set(matched)],
      })
    }
  }

  // 2. Transitive: entities in changed files → expand dependents → find pages
  //    containing those transitive entities.
  const directEntityIds = new Set(changedEntities(graph, changedSet).map(e => e.id))
  const expandedIds = expandDependents(graph, directEntityIds, transitiveDepth)
  // Remove seeds — we already handled direct pages
  for (const id of directEntityIds) expandedIds.delete(id)

  const transitiveFiles = new Set<string>()
  for (const e of graph.entities) {
    if (expandedIds.has(e.id)) transitiveFiles.add(norm(e.filePath))
  }

  const transitivePages = new Map<string, AffectedPage>()
  for (const page of pages) {
    if (directPages.has(page.id)) continue // already direct
    const sources = page.fileSources ?? []
    const matched: string[] = []
    for (const src of sources) {
      const ns = norm(src)
      for (const tf of transitiveFiles) {
        if (ns === tf || ns.endsWith('/' + tf) || tf.endsWith('/' + ns)) {
          matched.push(tf)
        }
      }
    }
    if (matched.length) {
      transitivePages.set(page.id, {
        id: page.id,
        slug: page.slug,
        title: page.title,
        reason: 'transitive',
        changedSources: [...new Set(matched)],
      })
    }
  }

  // 3. Special pages that are always affected when entities change.
  //    Overview & Architecture pages reference broad project state.
  //    Only flag them if not already in the set.
  const BROAD_SLUGS = new Set(['1-overview', '2-core-architecture'])
  for (const page of pages) {
    if (directPages.has(page.id) || transitivePages.has(page.id)) continue
    if (BROAD_SLUGS.has(page.slug) && changedFiles.length > 0) {
      transitivePages.set(page.id, {
        id: page.id,
        slug: page.slug,
        title: page.title,
        reason: 'transitive',
        changedSources: [],
      })
    }
  }

  const all = [...directPages.values(), ...transitivePages.values()]
  const fullRegenRecommended = all.length >= pages.length * 0.7

  return { affectedPages: all, totalPages: pages.length, fullRegenRecommended }
}

/**
 * Merge freshly regenerated pages into the existing page list, replacing only
 * the affected ones and keeping the rest intact.
 */
export function mergeRegenerated(
  existing: WikiPage[],
  regenerated: WikiPage[],
): WikiPage[] {
  const regenMap = new Map(regenerated.map(p => [p.id, p]))
  return existing.map(p => regenMap.get(p.id) ?? p)
}
