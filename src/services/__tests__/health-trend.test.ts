import { describe, it, expect } from 'vitest'
import { captureHealthSnapshot, buildHealthTrend, serializeHealthTrend, deserializeHealthTrend } from '../health-trend'
import type { HealthReport } from '../health-analyzer'

function makeReport(score: number, grade: HealthReport['grade']): HealthReport {
  return {
    score,
    grade,
    components: [],
    cycles: [],
    deadCode: [],
    hotspots: [],
    metrics: {
      entityCount: 100,
      relationCount: 50,
      fileCount: 20,
      avgDegree: 2.5,
      isolatedEntities: 5,
      deadCodeRatio: 0.1,
      circularDepCount: 2,
    },
  }
}

describe('captureHealthSnapshot', () => {
  it('creates snapshot from report', () => {
    const snap = captureHealthSnapshot(makeReport(75, 'B'), 'v1')
    expect(snap.score).toBe(75)
    expect(snap.grade).toBe('B')
    expect(snap.label).toBe('v1')
    expect(snap.timestamp).toBeGreaterThan(0)
    expect(snap.entityCount).toBe(100)
  })
})

describe('buildHealthTrend', () => {
  it('detects improvement', () => {
    const s1 = { ...captureHealthSnapshot(makeReport(50, 'D')), timestamp: 1000 }
    const s2 = { ...captureHealthSnapshot(makeReport(80, 'B')), timestamp: 2000 }
    const trend = buildHealthTrend([s1, s2])
    expect(trend.trend.scoreChange).toBe(30)
    expect(trend.trend.gradeImproved).toBe(true)
    expect(trend.trend.degraded).toBe(false)
  })

  it('detects degradation', () => {
    const s1 = { ...captureHealthSnapshot(makeReport(80, 'B')), timestamp: 1000 }
    const s2 = { ...captureHealthSnapshot(makeReport(40, 'D')), timestamp: 2000 }
    const trend = buildHealthTrend([s1, s2])
    expect(trend.trend.degraded).toBe(true)
  })

  it('handles single snapshot', () => {
    const s1 = captureHealthSnapshot(makeReport(70, 'C'))
    const trend = buildHealthTrend([s1])
    expect(trend.trend.scoreChange).toBe(0)
  })
})

describe('serialization', () => {
  it('round-trips through JSON', () => {
    const s1 = { ...captureHealthSnapshot(makeReport(60, 'C')), timestamp: 1000 }
    const trend = buildHealthTrend([s1])
    const json = serializeHealthTrend(trend)
    const restored = deserializeHealthTrend(json)
    expect(restored.snapshots).toHaveLength(1)
    expect(restored.snapshots[0].score).toBe(60)
  })
})
