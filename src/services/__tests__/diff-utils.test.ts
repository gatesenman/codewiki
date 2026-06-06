import { describe, it, expect } from 'vitest'
import { generateUnifiedDiff } from '../diff-utils'

describe('generateUnifiedDiff', () => {
  it('generates diff headers', () => {
    const diff = generateUnifiedDiff('hello', 'world', 'test.ts')
    expect(diff[0].content).toBe('--- a/test.ts')
    expect(diff[1].content).toBe('+++ b/test.ts')
    expect(diff[0].type).toBe('header')
  })

  it('shows added lines', () => {
    const diff = generateUnifiedDiff('', 'new line', 'test.ts')
    const addLines = diff.filter(l => l.type === 'add')
    expect(addLines.length).toBeGreaterThan(0)
  })

  it('shows removed lines', () => {
    const diff = generateUnifiedDiff('old line', '', 'test.ts')
    const removeLines = diff.filter(l => l.type === 'remove')
    expect(removeLines.length).toBeGreaterThan(0)
  })

  it('shows context for unchanged lines', () => {
    const original = 'line1\nline2\nold\nline4\nline5'
    const modified = 'line1\nline2\nnew\nline4\nline5'
    const diff = generateUnifiedDiff(original, modified, 'test.ts')
    const contextLines = diff.filter(l => l.type === 'context')
    expect(contextLines.length).toBeGreaterThan(0)
  })

  it('handles identical content', () => {
    const diff = generateUnifiedDiff('same', 'same', 'test.ts')
    const headers = diff.filter(l => l.type === 'header' && l.content.startsWith('---'))
    expect(headers).toHaveLength(1)
    // No hunks should be generated
    const hunks = diff.filter(l => l.content.startsWith('@@'))
    expect(hunks).toHaveLength(0)
  })

  it('handles multi-line changes', () => {
    const original = 'function foo() {\n  return 1\n}\n'
    const modified = 'function foo() {\n  return 2\n  // comment\n}\n'
    const diff = generateUnifiedDiff(original, modified, 'foo.ts')
    expect(diff.length).toBeGreaterThan(2) // headers + changes
  })
})
