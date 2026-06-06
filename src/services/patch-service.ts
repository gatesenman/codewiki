/**
 * Patch Service
 *
 * Applies a set of Code Agent modifications safely:
 *  - multiple edits to the same file are applied bottom-up so earlier edits
 *    don't shift the line numbers of later ones;
 *  - every edit is validated against its expected original before writing
 *    (a "dry run" / plan can be computed without touching disk);
 *  - application is atomic across files — if any file fails, all files that
 *    were already written are restored from their captured originals;
 *  - a rollback token (original contents) is returned so a successful apply
 *    can be undone later.
 *
 * IO is injected so the service is environment-agnostic and unit-testable
 * (the app wires it to the Electron `readFile`/`writeFile` bridge).
 */

import type { CodeModification } from '../types'

export interface PatchIO {
  readFile: (path: string) => Promise<string | null>
  writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
}

/** Per-file preview of what a patch would do. */
export interface FilePatchPreview {
  filePath: string
  ok: boolean
  error?: string
  editCount: number
  originalContent: string
  newContent: string
  diff: DiffHunk[]
}

export interface DiffHunk {
  startLine: number
  endLine: number
  before: string[]
  after: string[]
}

export interface PatchPlan {
  ok: boolean
  files: FilePatchPreview[]
  errors: string[]
}

/** Token that can be passed to `rollback` to undo a successful apply. */
export type RollbackToken = Record<string, string>

export interface ApplyResult {
  ok: boolean
  appliedFiles: string[]
  rollback: RollbackToken
  errors: string[]
}

function groupByFile(mods: CodeModification[]): Map<string, CodeModification[]> {
  const map = new Map<string, CodeModification[]>()
  for (const m of mods) {
    const list = map.get(m.filePath) || []
    list.push(m)
    map.set(m.filePath, list)
  }
  return map
}

/**
 * Apply a file's edits in-memory. Edits are applied from the bottom of the
 * file upward so line indices stay valid. Each edit is validated against its
 * `originalContent` (trimmed) when provided.
 */
export function computeFileContent(
  original: string,
  edits: CodeModification[],
): { ok: boolean; error?: string; newContent: string; diff: DiffHunk[] } {
  const lines = original.split('\n')
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine)
  const diff: DiffHunk[] = []

  // Validate first (against the pristine file) so a bad edit fails the plan
  // before any mutation.
  for (const e of edits) {
    if (e.startLine < 1 || e.endLine < e.startLine || e.endLine > lines.length) {
      return { ok: false, error: `Edit range ${e.startLine}-${e.endLine} is out of bounds (file has ${lines.length} lines)`, newContent: original, diff: [] }
    }
    const actual = lines.slice(e.startLine - 1, e.endLine).join('\n')
    if (e.originalContent && actual.trim() !== e.originalContent.trim()) {
      return { ok: false, error: `Content mismatch at ${e.filePath}:${e.startLine}-${e.endLine}; file may have changed`, newContent: original, diff: [] }
    }
  }

  for (const e of sorted) {
    const before = lines.slice(e.startLine - 1, e.endLine)
    const after = e.newContent.split('\n')
    diff.unshift({ startLine: e.startLine, endLine: e.endLine, before, after })
    lines.splice(e.startLine - 1, e.endLine - e.startLine + 1, ...after)
  }

  return { ok: true, newContent: lines.join('\n'), diff }
}

export class PatchService {
  constructor(private io: PatchIO) {}

  /** Validate edits and compute previews/diffs without writing anything. */
  async plan(mods: CodeModification[]): Promise<PatchPlan> {
    const files: FilePatchPreview[] = []
    const errors: string[] = []

    for (const [filePath, edits] of groupByFile(mods)) {
      const original = await this.io.readFile(filePath)
      if (original == null) {
        const error = `Cannot read ${filePath}`
        errors.push(error)
        files.push({ filePath, ok: false, error, editCount: edits.length, originalContent: '', newContent: '', diff: [] })
        continue
      }
      const r = computeFileContent(original, edits)
      if (!r.ok && r.error) errors.push(r.error)
      files.push({
        filePath, ok: r.ok, error: r.error, editCount: edits.length,
        originalContent: original, newContent: r.newContent, diff: r.diff,
      })
    }

    return { ok: errors.length === 0 && files.every(f => f.ok), files, errors }
  }

  /**
   * Atomically apply all edits. If any file fails, every file already written
   * in this call is restored, leaving the workspace unchanged.
   */
  async apply(mods: CodeModification[]): Promise<ApplyResult> {
    const plan = await this.plan(mods)
    if (!plan.ok) {
      return { ok: false, appliedFiles: [], rollback: {}, errors: plan.errors.length ? plan.errors : ['Patch plan is invalid'] }
    }

    const rollback: RollbackToken = {}
    const appliedFiles: string[] = []

    for (const file of plan.files) {
      const res = await this.io.writeFile(file.filePath, file.newContent)
      if (!res.success) {
        // Roll back everything written so far — atomic failure.
        const restoreErrors = await this.restore(rollback)
        return {
          ok: false,
          appliedFiles: [],
          rollback: {},
          errors: [`Failed to write ${file.filePath}: ${res.error || 'unknown error'}`, ...restoreErrors],
        }
      }
      rollback[file.filePath] = file.originalContent
      appliedFiles.push(file.filePath)
    }

    return { ok: true, appliedFiles, rollback, errors: [] }
  }

  /** Restore files to the contents captured in a rollback token. */
  async rollback(token: RollbackToken): Promise<{ ok: boolean; errors: string[] }> {
    const errors = await this.restore(token)
    return { ok: errors.length === 0, errors }
  }

  private async restore(token: RollbackToken): Promise<string[]> {
    const errors: string[] = []
    for (const [filePath, content] of Object.entries(token)) {
      const res = await this.io.writeFile(filePath, content)
      if (!res.success) errors.push(`Failed to restore ${filePath}: ${res.error || 'unknown error'}`)
    }
    return errors
  }
}
