/**
 * Git history insights (CodeFlow-inspired): per-file churn (commit frequency)
 * and code ownership (top authors) derived from `git log`.
 *
 * The parsing is pure (raw git output in → structured data out) so it can be
 * unit-tested and reused in CLI, Electron main, or MCP. Actually invoking git
 * is done by the caller (CLI / Electron main) and the text is passed here.
 *
 * Expected git invocation (callers should use exactly this format):
 *   git log --no-merges --pretty=format:'C|%H|%an|%at' --numstat
 */

export interface FileChurn {
  /** Repo-relative file path. */
  path: string
  /** Number of distinct commits that touched this file. */
  commits: number
  /** Total lines added + deleted across history. */
  linesChanged: number
  /** Unix seconds of the most recent commit touching this file. */
  lastCommit: number
  /** author name -> commit count, sorted desc (top owners first). */
  authors: Array<{ name: string; commits: number }>
}

export interface ChurnReport {
  files: FileChurn[]
  /** Max commit count across files (for normalizing a heatmap). */
  maxCommits: number
  totalCommits: number
}

interface Commit {
  hash: string
  author: string
  ts: number
}

/**
 * Parse `git log --pretty=format:'C|%H|%an|%at' --numstat` output into a churn
 * report. Renames in numstat (`{old => new}` / `a/{b => c}/d`) are normalized to
 * the new path on a best-effort basis.
 */
export function parseGitLog(raw: string): ChurnReport {
  const lines = raw.split('\n')
  let current: Commit | null = null

  const commitsByFile = new Map<string, Set<string>>()
  const linesByFile = new Map<string, number>()
  const lastByFile = new Map<string, number>()
  const authorsByFile = new Map<string, Map<string, Set<string>>>()
  const allCommits = new Set<string>()

  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('C|')) {
      const [, hash, author, at] = line.split('|')
      current = { hash: hash || '', author: author || 'unknown', ts: parseInt(at || '0', 10) || 0 }
      if (current.hash) allCommits.add(current.hash)
      continue
    }
    // numstat line: "<add>\t<del>\t<path>"
    const parts = line.split('\t')
    if (parts.length < 3 || !current) continue
    const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
    const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
    const filePath = normalizeRename(parts.slice(2).join('\t'))
    if (!filePath) continue

    if (!commitsByFile.has(filePath)) commitsByFile.set(filePath, new Set())
    commitsByFile.get(filePath)!.add(current.hash)
    linesByFile.set(filePath, (linesByFile.get(filePath) || 0) + added + deleted)
    lastByFile.set(filePath, Math.max(lastByFile.get(filePath) || 0, current.ts))
    if (!authorsByFile.has(filePath)) authorsByFile.set(filePath, new Map())
    const am = authorsByFile.get(filePath)!
    if (!am.has(current.author)) am.set(current.author, new Set())
    am.get(current.author)!.add(current.hash)
  }

  const files: FileChurn[] = []
  for (const [path, commitSet] of commitsByFile) {
    const am = authorsByFile.get(path) || new Map<string, Set<string>>()
    const authors = Array.from(am.entries())
      .map(([name, set]) => ({ name, commits: set.size }))
      .sort((a, b) => b.commits - a.commits)
    files.push({
      path,
      commits: commitSet.size,
      linesChanged: linesByFile.get(path) || 0,
      lastCommit: lastByFile.get(path) || 0,
      authors,
    })
  }
  files.sort((a, b) => b.commits - a.commits)

  return {
    files,
    maxCommits: files.reduce((m, f) => Math.max(m, f.commits), 0),
    totalCommits: allCommits.size,
  }
}

/** Normalize git rename notation to the resulting path. */
function normalizeRename(raw: string): string {
  let p = raw.trim()
  if (!p) return ''
  // "{old => new}" or "dir/{old => new}/file"
  const brace = p.match(/\{(.*?) => (.*?)\}/)
  if (brace) {
    p = p.replace(/\{(.*?) => (.*?)\}/, brace[2])
  } else if (p.includes(' => ')) {
    // "old => new"
    p = p.split(' => ').pop() || p
  }
  return p.replace(/\/\//g, '/').trim()
}

/** Build a path -> churn lookup for quick joins with the ontology graph. */
export function churnByPath(report: ChurnReport): Map<string, FileChurn> {
  const m = new Map<string, FileChurn>()
  for (const f of report.files) m.set(f.path, f)
  return m
}

/**
 * Heat level 0..1 for a file given the report's max — useful for coloring.
 * Uses a log scale so a few very hot files don't flatten everything else.
 */
export function churnHeat(commits: number, maxCommits: number): number {
  if (maxCommits <= 0 || commits <= 0) return 0
  return Math.log(1 + commits) / Math.log(1 + maxCommits)
}
