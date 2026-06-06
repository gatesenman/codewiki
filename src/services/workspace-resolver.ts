/**
 * Workspace / monorepo resolver (P2-8/9).
 *
 * Detects the packages of a monorepo (npm/yarn/pnpm workspaces, or simply any
 * directory that ships its own package.json) and lifts the ontology to the
 * package level:
 *   - adds a `Package` entity per workspace package,
 *   - adds `contains` edges from each package to the entities under its dir,
 *   - promotes cross-file `imports` that cross a package boundary into
 *     package-to-package `dependsOn` edges.
 *
 * This gives the graph (and everything built on it — impact analysis, blast
 * radius, the agent) real monorepo awareness, and enables loading a single
 * package's subgraph on demand instead of the whole repo (scalability).
 *
 * Pure and dependency-free so it can run in the renderer and be unit-tested
 * without Electron/IO.
 */

import type { OntologyEntity, OntologyGraph } from '../types'

export interface WorkspacePackage {
  name: string
  /** Absolute directory of the package (the folder containing its package.json). */
  dir: string
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const dirOf = (filePath: string) => {
  const n = norm(filePath)
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(0, i) : n
}

/**
 * Decide whether a project is a monorepo worth lifting to the package level.
 * True when the root declares workspaces, a pnpm/lerna workspace file exists,
 * or more than one package.json is present.
 */
export function isMonorepo(opts: {
  rootPackageJson?: string | null
  hasWorkspaceFile?: boolean
  packageJsonCount: number
}): boolean {
  if (opts.hasWorkspaceFile) return true
  if (opts.packageJsonCount > 1) return true
  if (opts.rootPackageJson) {
    try {
      const pkg = JSON.parse(opts.rootPackageJson)
      if (pkg && pkg.workspaces) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

/**
 * Resolve workspace packages from a map of `package.json` path -> raw content.
 * Every package.json that has a `name` becomes a package keyed by its directory;
 * the repo root is included only if it has a name and there are no nested ones.
 */
export function resolvePackages(packageJsonByPath: Map<string, string>, rootDir?: string): WorkspacePackage[] {
  const root = rootDir ? norm(rootDir) : undefined
  const nested: WorkspacePackage[] = []
  let rootPkg: WorkspacePackage | undefined

  for (const [path, content] of packageJsonByPath) {
    let name: string | undefined
    try {
      name = (JSON.parse(content) as { name?: string }).name
    } catch {
      continue
    }
    if (!name) continue
    const dir = dirOf(path)
    if (root && dir === root) rootPkg = { name, dir }
    else nested.push({ name, dir })
  }

  // Prefer the nested packages; fall back to the root package when alone.
  const packages = nested.length ? nested : rootPkg ? [rootPkg] : []
  // Longest dir first so the most specific package wins when nested.
  return packages.sort((a, b) => b.dir.length - a.dir.length)
}

/** Find the package that owns a file (deepest matching package dir). */
export function packageForFile(packages: WorkspacePackage[], filePath: string): WorkspacePackage | undefined {
  const f = norm(filePath)
  for (const pkg of packages) {
    if (f === pkg.dir || f.startsWith(pkg.dir + '/')) return pkg
  }
  return undefined
}

export interface WorkspaceMergeStats {
  packages: number
  dependsOn: number
  contains: number
}

/**
 * Add Package entities and package-level relations to the graph in place.
 * `imports` relations whose endpoints live in different packages become
 * `dependsOn` edges between the package nodes (deduped).
 */
export function integrateWorkspaces(graph: OntologyGraph, packages: WorkspacePackage[]): WorkspaceMergeStats {
  if (!packages.length) return { packages: 0, dependsOn: 0, contains: 0 }

  const pkgId = (p: WorkspacePackage) => `pkg:${p.name}@${p.dir}`
  const entityById = new Map(graph.entities.map(e => [e.id, e]))

  // Add a Package entity per workspace package.
  let containsCount = 0
  for (const p of packages) {
    const id = pkgId(p)
    if (!entityById.has(id)) {
      const ent: OntologyEntity = {
        id, name: p.name, type: 'Package', filePath: p.dir, line: 1, endLine: 1,
        description: `Workspace package at ${p.dir}`,
      }
      graph.entities.push(ent)
      entityById.set(id, ent)
    }
  }

  const existing = new Set(graph.relations.map(r => `${r.source}|${r.target}|${r.type}`))
  let counter = graph.relations.length
  const addRel = (source: string, target: string, type: 'dependsOn' | 'contains', metadata?: Record<string, string>) => {
    const key = `${source}|${target}|${type}`
    if (existing.has(key)) return false
    existing.add(key)
    graph.relations.push({ id: `ws_rel_${counter++}`, source, target, type, metadata })
    return true
  }

  // contains: package -> top-level File/Module entities it owns.
  for (const e of graph.entities) {
    if (e.type === 'Package') continue
    if (e.type !== 'File' && e.type !== 'Module') continue
    const owner = packageForFile(packages, e.filePath)
    if (owner && addRel(pkgId(owner), e.id, 'contains')) containsCount++
  }

  // dependsOn: cross-package imports -> package dependency.
  let dependsCount = 0
  for (const rel of [...graph.relations]) {
    if (rel.type !== 'imports') continue
    const src = entityById.get(rel.source)
    const tgt = entityById.get(rel.target)
    if (!src || !tgt) continue
    const sp = packageForFile(packages, src.filePath)
    const tp = packageForFile(packages, tgt.filePath)
    if (sp && tp && sp.dir !== tp.dir) {
      if (addRel(pkgId(sp), pkgId(tp), 'dependsOn', { via: 'imports' })) dependsCount++
    }
  }

  return { packages: packages.length, dependsOn: dependsCount, contains: containsCount }
}

/**
 * Extract the subgraph belonging to a single package (its entities + relations
 * fully inside it), so large monorepos can load one package at a time.
 */
export function subgraphForPackage(graph: OntologyGraph, pkgDir: string): OntologyGraph {
  const dir = norm(pkgDir)
  const inPkg = (filePath: string) => {
    const f = norm(filePath)
    return f === dir || f.startsWith(dir + '/')
  }
  const entities = graph.entities.filter(e => e.type === 'Package' ? norm(e.filePath) === dir : inPkg(e.filePath))
  const ids = new Set(entities.map(e => e.id))
  const relations = graph.relations.filter(r => ids.has(r.source) && ids.has(r.target))
  return { entities, relations }
}

/** package.json basename check used by the indexer when collecting manifests. */
export const isPackageJson = (filePath: string) => norm(filePath).endsWith('/package.json') || norm(filePath) === 'package.json'
export const WORKSPACE_FILES = ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'rush.json']
