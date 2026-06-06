/**
 * Diff Utilities
 *
 * Generates unified-diff style output for code modifications.
 * Used by the Code Agent panel for better diff visualization.
 *
 * Pure function — before/after strings in → diff lines out.
 */

export interface DiffLine {
  type: 'context' | 'add' | 'remove' | 'header'
  content: string
  oldLine?: number
  newLine?: number
}

/**
 * Generate a simple unified diff between two code strings.
 * Uses a basic LCS-like approach for line-level diffing.
 */
export function generateUnifiedDiff(
  original: string,
  modified: string,
  filePath: string,
  contextLines: number = 3,
): DiffLine[] {
  const oldLines = original.split('\n')
  const newLines = modified.split('\n')
  const result: DiffLine[] = []

  result.push({ type: 'header', content: `--- a/${filePath}` })
  result.push({ type: 'header', content: `+++ b/${filePath}` })

  // Simple line-by-line diff using LCS
  const lcs = computeLCS(oldLines, newLines)
  const changes = buildChanges(oldLines, newLines, lcs)

  // Group into hunks with context
  const hunks = groupIntoHunks(changes, contextLines, oldLines.length, newLines.length)

  for (const hunk of hunks) {
    result.push({
      type: 'header',
      content: `@@ -${hunk.oldStart + 1},${hunk.oldCount} +${hunk.newStart + 1},${hunk.newCount} @@`,
    })
    for (const line of hunk.lines) {
      result.push(line)
    }
  }

  return result
}

interface Change {
  type: 'keep' | 'add' | 'remove'
  content: string
  oldIdx?: number
  newIdx?: number
}

interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp
}

function buildChanges(oldLines: string[], newLines: string[], dp: number[][]): Change[] {
  const changes: Change[] = []
  let i = oldLines.length
  let j = newLines.length

  const stack: Change[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'keep', content: oldLines[i - 1], oldIdx: i - 1, newIdx: j - 1 })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'add', content: newLines[j - 1], newIdx: j - 1 })
      j--
    } else {
      stack.push({ type: 'remove', content: oldLines[i - 1], oldIdx: i - 1 })
      i--
    }
  }

  // Reverse because we built it backwards
  for (let k = stack.length - 1; k >= 0; k--) {
    changes.push(stack[k])
  }

  return changes
}

function groupIntoHunks(
  changes: Change[],
  context: number,
  _oldTotal: number,
  _newTotal: number,
): Hunk[] {
  // Find ranges of non-keep changes
  const changeIndices: number[] = []
  for (let i = 0; i < changes.length; i++) {
    if (changes[i].type !== 'keep') changeIndices.push(i)
  }

  if (changeIndices.length === 0) return []

  // Build hunks around change clusters
  const hunks: Hunk[] = []
  let hunkStart = Math.max(0, changeIndices[0] - context)
  let hunkEnd = Math.min(changes.length - 1, changeIndices[0] + context)

  for (let k = 1; k < changeIndices.length; k++) {
    const nextStart = changeIndices[k] - context
    if (nextStart <= hunkEnd + 1) {
      // Merge with current hunk
      hunkEnd = Math.min(changes.length - 1, changeIndices[k] + context)
    } else {
      // Emit current hunk
      hunks.push(buildHunk(changes, hunkStart, hunkEnd))
      hunkStart = nextStart
      hunkEnd = Math.min(changes.length - 1, changeIndices[k] + context)
    }
  }
  hunks.push(buildHunk(changes, hunkStart, hunkEnd))

  return hunks
}

function buildHunk(changes: Change[], start: number, end: number): Hunk {
  const lines: DiffLine[] = []
  let oldStart = Infinity
  let newStart = Infinity
  let oldCount = 0
  let newCount = 0

  for (let i = start; i <= end; i++) {
    const c = changes[i]
    switch (c.type) {
      case 'keep':
        lines.push({ type: 'context', content: ` ${c.content}`, oldLine: c.oldIdx, newLine: c.newIdx })
        if (c.oldIdx !== undefined && c.oldIdx < oldStart) oldStart = c.oldIdx
        if (c.newIdx !== undefined && c.newIdx < newStart) newStart = c.newIdx
        oldCount++; newCount++
        break
      case 'remove':
        lines.push({ type: 'remove', content: `-${c.content}`, oldLine: c.oldIdx })
        if (c.oldIdx !== undefined && c.oldIdx < oldStart) oldStart = c.oldIdx
        oldCount++
        break
      case 'add':
        lines.push({ type: 'add', content: `+${c.content}`, newLine: c.newIdx })
        if (c.newIdx !== undefined && c.newIdx < newStart) newStart = c.newIdx
        newCount++
        break
    }
  }

  if (oldStart === Infinity) oldStart = 0
  if (newStart === Infinity) newStart = 0

  return { oldStart, oldCount, newStart, newCount, lines }
}
