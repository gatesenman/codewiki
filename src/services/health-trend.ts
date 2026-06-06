/**
 * Health Trend Tracking
 *
 * Records health metrics over time so the user can visualize
 * how code quality evolves across indexing sessions.
 *
 * Pure functions — health report in → trend data out.
 */

import type { HealthReport } from './health-analyzer'

export interface HealthSnapshot {
  timestamp: number
  label?: string
  score: number
  grade: HealthReport['grade']
  deadCodeCount: number
  circularDepCount: number
  hotspotCount: number
  entityCount: number
  relationCount: number
}

export interface HealthTrend {
  snapshots: HealthSnapshot[]
  trend: {
    scoreChange: number
    gradeImproved: boolean
    degraded: boolean
  }
}

/**
 * Create a snapshot from a HealthReport.
 */
export function captureHealthSnapshot(
  report: HealthReport,
  label?: string,
): HealthSnapshot {
  return {
    timestamp: Date.now(),
    label,
    score: report.score,
    grade: report.grade,
    deadCodeCount: report.deadCode.length,
    circularDepCount: report.metrics.circularDepCount,
    hotspotCount: report.hotspots.length,
    entityCount: report.metrics.entityCount,
    relationCount: report.metrics.relationCount,
  }
}

/**
 * Build trend analysis from a list of snapshots.
 */
export function buildHealthTrend(snapshots: HealthSnapshot[]): HealthTrend {
  const ordered = [...snapshots].sort((a, b) => a.timestamp - b.timestamp)

  if (ordered.length < 2) {
    return {
      snapshots: ordered,
      trend: { scoreChange: 0, gradeImproved: false, degraded: false },
    }
  }

  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const gradeOrder = ['F', 'D', 'C', 'B', 'A']

  return {
    snapshots: ordered,
    trend: {
      scoreChange: last.score - first.score,
      gradeImproved: gradeOrder.indexOf(last.grade) > gradeOrder.indexOf(first.grade),
      degraded: gradeOrder.indexOf(last.grade) < gradeOrder.indexOf(first.grade),
    },
  }
}

/**
 * Serialize trend data for persistence.
 */
export function serializeHealthTrend(trend: HealthTrend): string {
  return JSON.stringify(trend, null, 2)
}

/**
 * Deserialize trend data.
 */
export function deserializeHealthTrend(json: string): HealthTrend {
  return JSON.parse(json)
}
