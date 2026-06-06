import { describe, it, expect } from 'vitest'
import { parseDiff, findDirectlyChangedEntities, findIndirectlyImpacted, reviewDiff } from '../pr-review'
import type { OntologyGraph } from '../../types'

const SAMPLE_DIFF = `diff --git a/src/services/user.ts b/src/services/user.ts
--- a/src/services/user.ts
+++ b/src/services/user.ts
@@ -10,6 +10,8 @@
 existing line
-removed line
+added line 1
+added line 2
diff --git a/src/controllers/api.ts b/src/controllers/api.ts
--- a/src/controllers/api.ts
+++ b/src/controllers/api.ts
@@ -5,3 +5,4 @@
-old
+new
+another`

function makeGraph(): OntologyGraph {
  return {
    entities: [
      { id: 'e1', name: 'UserService', type: 'Class', filePath: 'src/services/user.ts', line: 1, endLine: 50 },
      { id: 'e2', name: 'ApiController', type: 'Class', filePath: 'src/controllers/api.ts', line: 1, endLine: 30 },
      { id: 'e3', name: 'AuthMiddleware', type: 'Function', filePath: 'src/middleware/auth.ts', line: 1, endLine: 20 },
    ],
    relations: [
      { id: 'r1', source: 'e2', target: 'e1', type: 'calls' },
      { id: 'r2', source: 'e3', target: 'e1', type: 'uses' },
    ],
  }
}

describe('parseDiff', () => {
  it('extracts file hunks with line counts', () => {
    const hunks = parseDiff(SAMPLE_DIFF)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].filePath).toBe('src/services/user.ts')
    expect(hunks[0].addedLines).toBe(2)
    expect(hunks[0].removedLines).toBe(1)
    expect(hunks[1].filePath).toBe('src/controllers/api.ts')
  })
})

describe('findDirectlyChangedEntities', () => {
  it('finds entities in changed files', () => {
    const hunks = parseDiff(SAMPLE_DIFF)
    const entities = findDirectlyChangedEntities(hunks, makeGraph())
    expect(entities.map(e => e.name)).toContain('UserService')
    expect(entities.map(e => e.name)).toContain('ApiController')
    expect(entities.map(e => e.name)).not.toContain('AuthMiddleware')
  })
})

describe('findIndirectlyImpacted', () => {
  it('finds callers of changed entities', () => {
    const graph = makeGraph()
    const direct = [graph.entities[0]] // UserService
    const indirect = findIndirectlyImpacted(direct, graph)
    // ApiController and AuthMiddleware both depend on UserService
    expect(indirect.map(e => e.name)).toContain('ApiController')
    expect(indirect.map(e => e.name)).toContain('AuthMiddleware')
  })
})

describe('reviewDiff', () => {
  it('produces a review with findings and stats', () => {
    const review = reviewDiff(SAMPLE_DIFF, makeGraph())
    expect(review.riskScore).toBeGreaterThanOrEqual(0)
    expect(review.stats.filesChanged).toBe(2)
    expect(review.stats.addedLines).toBeGreaterThan(0)
    expect(review.summary).toBeTruthy()
  })
})
