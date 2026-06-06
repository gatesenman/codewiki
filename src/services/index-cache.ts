/**
 * Persistent Index Cache
 *
 * Serializes a project's computed index (ontology graph + vector store +
 * a file manifest) to disk so reopening a project does not require a full
 * re-index. On reopen the manifest is diffed against the current files so
 * only changed/added/removed files need work — the expensive embedding step
 * is reused for everything unchanged.
 *
 * Storage goes through the Electron bridge (`saveIndexData`/`loadIndexData`).
 * When that bridge is unavailable (e.g. browser/dev), the cache is a no-op
 * and callers transparently fall back to a full index.
 */

import type { FileNode, OntologyGraph } from '../types'
import type { VectorStoreSnapshot } from './vector-store'

export const INDEX_SNAPSHOT_VERSION = 1

/** path -> change-detection fingerprint */
export type FileManifest = Record<string, { size: number; mtimeMs: number }>

export interface ProjectIndexSnapshot {
  version: number
  cacheKey: string
  name: string
  path: string
  type: 'local' | 'github'
  generatedAt: number
  manifest: FileManifest
  ontologyGraph: OntologyGraph
  vectors: VectorStoreSnapshot
}

export interface ManifestDiff {
  added: string[]
  changed: string[]
  deleted: string[]
  unchanged: number
}

/** Stable, filesystem-safe cache key derived from a project path/URL. */
export function cacheKeyFor(pathOrUrl: string): string {
  let hash = 5381
  for (let i = 0; i < pathOrUrl.length; i++) {
    hash = ((hash << 5) + hash + pathOrUrl.charCodeAt(i)) | 0
  }
  return 'p' + (hash >>> 0).toString(36)
}

function flatten(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    out.push(node)
    if (node.children) flatten(node.children, out)
  }
  return out
}

/** Build a manifest of code files keyed by absolute path. */
export function buildManifest(files: FileNode[]): FileManifest {
  const manifest: FileManifest = {}
  for (const f of flatten(files)) {
    if (f.type !== 'file') continue
    manifest[f.path] = { size: f.size ?? 0, mtimeMs: f.mtimeMs ?? 0 }
  }
  return manifest
}

/**
 * Compare a previous manifest with the current one. A file counts as changed
 * when its size or mtime differs. When mtime is unavailable on both sides
 * (mtimeMs === 0), only size is compared.
 */
export function diffManifest(previous: FileManifest, current: FileManifest): ManifestDiff {
  const added: string[] = []
  const changed: string[] = []
  const deleted: string[] = []
  let unchanged = 0

  for (const [path, cur] of Object.entries(current)) {
    const prev = previous[path]
    if (!prev) {
      added.push(path)
    } else if (prev.size !== cur.size || prev.mtimeMs !== cur.mtimeMs) {
      changed.push(path)
    } else {
      unchanged++
    }
  }
  for (const path of Object.keys(previous)) {
    if (!(path in current)) deleted.push(path)
  }
  return { added, changed, deleted, unchanged }
}

export function isClean(diff: ManifestDiff): boolean {
  return diff.added.length === 0 && diff.changed.length === 0 && diff.deleted.length === 0
}

/** Persist a snapshot. Returns false when no storage bridge is available. */
export async function saveSnapshot(snapshot: ProjectIndexSnapshot): Promise<boolean> {
  const api = globalThis.window?.electronAPI
  if (!api?.saveIndexData) return false
  try {
    return await api.saveIndexData(snapshot.cacheKey, JSON.stringify(snapshot))
  } catch {
    return false
  }
}

/** Load a snapshot, or null when missing/unavailable/incompatible. */
export async function loadSnapshot(cacheKey: string): Promise<ProjectIndexSnapshot | null> {
  const api = globalThis.window?.electronAPI
  if (!api?.loadIndexData) return null
  try {
    const raw = await api.loadIndexData(cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectIndexSnapshot
    if (parsed.version !== INDEX_SNAPSHOT_VERSION) return null
    return parsed
  } catch {
    return null
  }
}
