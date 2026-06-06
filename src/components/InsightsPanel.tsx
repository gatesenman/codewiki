import { useState, useCallback, useMemo } from 'react'
import {
  Activity, Search, History, FileText, FlaskConical,
  Camera, Trash2, ArrowRight, AlertTriangle, CheckCircle2,
  HeartPulse, RefreshCw,
} from 'lucide-react'
import { useAppStore } from '../store'
import { t, tEntityType } from '../services/i18n'
import { answerQuery, type QueryResult } from '../services/graph-query'
import {
  buildTimeline,
  type GraphSnapshot, type EvolutionTimeline,
} from '../services/graph-history'
import {
  computeIncrementalPlan, type IncrementalPlan,
} from '../services/wiki-incremental'
import {
  runEval, compareToBaseline,
  type EvalCase, type EvalReport, type Regression,
} from '../services/eval-harness'
import { analyzeHealth, type HealthReport } from '../services/health-analyzer'
import type { OntologyEntityType, OntologyGraph, WikiPage } from '../types'

type InsightTab = 'health' | 'query' | 'history' | 'wiki' | 'eval'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export function InsightsPanel() {
  useAppStore(s => s.locale)
  const currentProject = useAppStore(s => s.currentProject)
  const graph = currentProject?.ontologyGraph
  const wikiPages = currentProject?.wikiPages ?? []

  const [tab, setTab] = useState<InsightTab>('health')

  if (!currentProject || !graph) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-wiki-muted gap-3">
        <Activity size={40} className="opacity-40" />
        <p className="text-sm">{t('insNoProject')}</p>
      </div>
    )
  }

  const TABS: Array<{ id: InsightTab; label: string; icon: typeof Search }> = [
    { id: 'health', label: t('insTabHealth'), icon: HeartPulse },
    { id: 'query', label: t('insTabQuery'), icon: Search },
    { id: 'history', label: t('insTabHistory'), icon: History },
    { id: 'wiki', label: t('insTabWiki'), icon: FileText },
    { id: 'eval', label: t('insTabEval'), icon: FlaskConical },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-wiki-border">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-wiki-accent" />
          <h1 className="text-base font-semibold text-wiki-text">{t('insTitle')}</h1>
        </div>
        <p className="text-xs text-wiki-muted mt-1">{t('insSubtitle')}</p>
        {/* Sub tabs */}
        <div className="flex items-center gap-1 mt-3">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === id
                  ? 'bg-wiki-accent/10 text-wiki-accent'
                  : 'text-wiki-muted hover:text-wiki-text hover:bg-wiki-card/50'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {tab === 'health' && <HealthTool graph={graph} />}
        {tab === 'query' && <QueryTool graph={graph} />}
        {tab === 'history' && <HistoryTool graph={graph} />}
        {tab === 'wiki' && <WikiTool graph={graph} wikiPages={wikiPages} />}
        {tab === 'eval' && <EvalTool graph={graph} />}
      </div>
    </div>
  )
}

// ---- Health (health-analyzer) --------------------------------------------

const GRADE_COLOR: Record<HealthReport['grade'], string> = {
  A: 'text-green-500 border-green-500/40 bg-green-500/10',
  B: 'text-lime-500 border-lime-500/40 bg-lime-500/10',
  C: 'text-amber-500 border-amber-500/40 bg-amber-500/10',
  D: 'text-orange-500 border-orange-500/40 bg-orange-500/10',
  F: 'text-red-500 border-red-500/40 bg-red-500/10',
}

function barColor(score: number): string {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

function HealthTool({ graph }: { graph: OntologyGraph }) {
  const setSelectedEntityId = useAppStore(s => s.setSelectedEntityId)
  const [nonce, setNonce] = useState(0)
  const report = useMemo(() => analyzeHealth(graph), [graph, nonce])
  const shortFile = (p: string) => p.split(/[\\/]/).pop() || p

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-wiki-muted">{t('insHealthHint')}</p>
        <button
          onClick={() => setNonce(n => n + 1)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-wiki-muted hover:text-wiki-text hover:bg-wiki-card/50"
        >
          <RefreshCw size={12} /> {t('insHealthRefresh')}
        </button>
      </div>

      {/* Grade + score */}
      <div className="flex items-center gap-4">
        <div className={`w-20 h-20 rounded-xl border flex flex-col items-center justify-center ${GRADE_COLOR[report.grade]}`}>
          <span className="text-3xl font-bold leading-none">{report.grade}</span>
          <span className="text-xs mt-1 opacity-80">{report.score}/100</span>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-2">
          <Metric label={t('insHealthEntities')} value={report.metrics.entityCount} />
          <Metric label={t('insHealthFiles')} value={report.metrics.fileCount} />
          <Metric label={t('insHealthAvgDegree')} value={report.metrics.avgDegree} />
          <Metric label={t('insHealthCircular')} value={report.metrics.circularDepCount} danger={report.metrics.circularDepCount > 0} />
          <Metric label={t('insHealthDead')} value={report.deadCode.length} danger={report.deadCode.length > 0} />
          <Metric label={t('insHealthGod')} value={report.hotspots.filter(h => h.godObject).length} danger={report.hotspots.some(h => h.godObject)} />
        </div>
      </div>

      {/* Components breakdown */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-wiki-text">{t('insHealthBreakdown')}</div>
        {report.components.map(c => (
          <div key={c.key} className="flex items-center gap-3">
            <span className="w-28 text-xs text-wiki-muted">{t(('insHealthC_' + c.key) as Parameters<typeof t>[0]) || c.key}</span>
            <div className="flex-1 h-2 rounded-full bg-wiki-card overflow-hidden">
              <div className={`h-full ${barColor(c.score)}`} style={{ width: `${c.score}%` }} />
            </div>
            <span className="w-10 text-right text-xs text-wiki-text">{c.score}</span>
            <span className="w-28 text-right text-[11px] text-wiki-muted truncate">{c.detail}</span>
          </div>
        ))}
      </div>

      {/* Circular dependencies */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-wiki-text flex items-center gap-1.5">
          <AlertTriangle size={13} className={report.cycles.length ? 'text-red-500' : 'text-green-500'} />
          {t('insHealthCircularTitle')} ({report.cycles.length})
        </div>
        {report.cycles.length === 0 ? (
          <div className="text-sm text-green-500 flex items-center gap-1.5"><CheckCircle2 size={14} /> {t('insHealthNoCircular')}</div>
        ) : (
          <div className="space-y-1.5">
            {report.cycles.slice(0, 8).map((c, i) => (
              <div key={i} className="text-xs bg-wiki-card rounded-md px-3 py-2">
                <span className="text-red-400 font-medium">{c.files.length} {t('insHealthFilesWord')} · {c.edges} {t('insHealthEdgesWord')}</span>
                <span className="text-wiki-muted ml-2">{c.files.map(shortFile).join(' → ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Coupling hotspots */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-wiki-text">{t('insHealthHotspots')} ({report.hotspots.length})</div>
        {report.hotspots.length === 0 ? (
          <div className="text-sm text-wiki-muted">{t('insHealthNoHotspots')}</div>
        ) : (
          <div className="space-y-1">
            {report.hotspots.slice(0, 10).map(h => (
              <button
                key={h.id}
                onClick={() => setSelectedEntityId(h.id)}
                className="w-full flex items-center gap-2 text-left text-sm px-3 py-1.5 rounded-md hover:bg-wiki-card/60"
              >
                {h.godObject && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">God</span>}
                <span className="font-medium text-wiki-text">{h.name}</span>
                <span className="text-[11px] text-wiki-muted">{tEntityType(h.type as OntologyEntityType)}</span>
                <span className="ml-auto text-[11px] text-wiki-muted">in {h.fanIn} · out {h.fanOut}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="bg-wiki-card rounded-md px-3 py-2">
      <div className={`text-lg font-semibold ${danger ? 'text-red-400' : 'text-wiki-text'}`}>{value}</div>
      <div className="text-[11px] text-wiki-muted">{label}</div>
    </div>
  )
}

// ---- NL Query (graph-query) ----------------------------------------------

function QueryTool({ graph }: { graph: OntologyGraph }) {
  const setSelectedEntityId = useAppStore(s => s.setSelectedEntityId)
  const [text, setText] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [missed, setMissed] = useState(false)

  const run = useCallback(() => {
    if (!text.trim()) return
    const r = answerQuery(graph, text)
    setResult(r)
    setMissed(r === null)
  }, [text, graph])

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run() }}
          placeholder={t('insQueryPlaceholder')}
          className="flex-1 px-3 py-2 rounded-md bg-wiki-card border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted focus:outline-none focus:border-wiki-accent"
        />
        <button
          onClick={run}
          className="px-4 py-2 rounded-md bg-wiki-accent/10 text-wiki-accent hover:bg-wiki-accent/20 text-sm font-medium transition-colors"
        >
          {t('insQueryRun')}
        </button>
      </div>
      <p className="text-xs text-wiki-muted">{t('insQueryHint')}</p>

      {missed && (
        <div className="flex items-center gap-2 text-sm text-amber-500">
          <AlertTriangle size={14} />
          {t('insQueryNoResult')}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="text-sm text-wiki-text bg-wiki-card border border-wiki-border rounded-md px-3 py-2">
            {result.summary}
          </div>
          {result.entities.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-wiki-muted mb-1.5">
                {t('insQueryEntities')} ({result.entities.length})
              </div>
              <div className="space-y-1">
                {result.entities.slice(0, 100).map(e => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEntityId(e.id)}
                    className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-wiki-card transition-colors"
                  >
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-wiki-accent/10 text-wiki-accent shrink-0">
                      {tEntityType(e.type as OntologyEntityType)}
                    </span>
                    <span className="text-sm text-wiki-text font-medium">{e.name}</span>
                    <span className="text-xs text-wiki-muted truncate">{e.filePath}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-wiki-muted">
            {t('insQueryRelations')}: {result.relations.length}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Evolution (graph-history) -------------------------------------------

function HistoryTool({ graph }: { graph: OntologyGraph }) {
  const [snapshots, setSnapshots] = useState<GraphSnapshot[]>([])

  const capture = useCallback(() => {
    const now = Date.now()
    setSnapshots(prev => [...prev, {
      ref: `#${prev.length + 1}`,
      label: new Date(now).toLocaleTimeString(),
      timestamp: now,
      // deep-ish clone so later re-index doesn't mutate this snapshot
      graph: { entities: [...graph.entities], relations: [...graph.relations] },
    }])
  }, [graph])

  const timeline: EvolutionTimeline | null = snapshots.length ? buildTimeline(snapshots) : null

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={capture}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-wiki-accent/10 text-wiki-accent hover:bg-wiki-accent/20 text-sm font-medium transition-colors"
        >
          <Camera size={14} />
          {t('insHistSnapshot')}
        </button>
        {snapshots.length > 0 && (
          <button
            onClick={() => setSnapshots([])}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-wiki-muted hover:text-wiki-text hover:bg-wiki-card text-sm transition-colors"
          >
            <Trash2 size={14} />
            {t('insHistClear')}
          </button>
        )}
      </div>
      <p className="text-xs text-wiki-muted">{t('insHistHint')}</p>

      {!timeline && (
        <p className="text-sm text-wiki-muted">{t('insHistNoSnapshots')}</p>
      )}

      {timeline && (
        <div className="space-y-4">
          {/* Trend */}
          <div className="bg-wiki-card border border-wiki-border rounded-md px-4 py-3 text-sm">
            <span className="font-semibold text-wiki-text">{t('insHistTrend')}: </span>
            <span className="text-wiki-text">
              {timeline.trend.entityGrowth >= 0 ? '+' : ''}{timeline.trend.entityGrowth} {t('insHistEntities')}, {' '}
              {timeline.trend.relationGrowth >= 0 ? '+' : ''}{timeline.trend.relationGrowth} {t('insHistRelations')}, {' '}
              {timeline.trend.couplingIncreasing ? t('insHistCouplingUp') : t('insHistCouplingStable')}
            </span>
          </div>

          {/* Per-snapshot metrics */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-wiki-muted border-b border-wiki-border">
                  <th className="py-1.5 pr-4"></th>
                  <th className="py-1.5 pr-4">{t('insHistEntities')}</th>
                  <th className="py-1.5 pr-4">{t('insHistRelations')}</th>
                  <th className="py-1.5 pr-4">avgDegree</th>
                  <th className="py-1.5 pr-4">isolated</th>
                </tr>
              </thead>
              <tbody>
                {timeline.metrics.map(m => (
                  <tr key={m.ref} className="border-b border-wiki-border/50">
                    <td className="py-1.5 pr-4 text-wiki-text font-medium">{m.ref} <span className="text-wiki-muted font-normal">{m.label}</span></td>
                    <td className="py-1.5 pr-4 text-wiki-text">{m.entityCount}</td>
                    <td className="py-1.5 pr-4 text-wiki-text">{m.relationCount}</td>
                    <td className="py-1.5 pr-4 text-wiki-text">{m.avgDegree}</td>
                    <td className="py-1.5 pr-4 text-wiki-text">{m.isolatedEntities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Diffs */}
          {timeline.diffs.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-wiki-muted mb-1.5">{t('insHistDiff')}</div>
              <div className="space-y-1.5">
                {timeline.diffs.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-wiki-card border border-wiki-border rounded-md px-3 py-2">
                    <span className="text-wiki-muted">{d.fromRef}</span>
                    <ArrowRight size={12} className="text-wiki-muted" />
                    <span className="text-wiki-muted">{d.toRef}</span>
                    <span className="text-green-500 ml-2">+{d.addedEntities.length} {t('insHistAdded')}</span>
                    <span className="text-red-500">-{d.removedEntities.length} {t('insHistRemoved')}</span>
                    <span className="text-amber-500">~{d.movedEntities.length} {t('insHistMoved')}</span>
                    <span className="text-wiki-muted ml-auto">Δrel {d.relationDelta >= 0 ? '+' : ''}{d.relationDelta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Wiki incremental ----------------------------------------------------

function WikiTool({ graph, wikiPages }: { graph: OntologyGraph; wikiPages: WikiPage[] }) {
  const [text, setText] = useState('')
  const [plan, setPlan] = useState<IncrementalPlan | null>(null)

  const run = useCallback(() => {
    const files = text.split('\n').map(s => s.trim()).filter(Boolean)
    setPlan(computeIncrementalPlan(wikiPages, graph, files))
  }, [text, graph, wikiPages])

  return (
    <div className="max-w-3xl space-y-4">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t('insWikiPlaceholder')}
        rows={5}
        className="w-full px-3 py-2 rounded-md bg-wiki-card border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted focus:outline-none focus:border-wiki-accent font-mono"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          className="px-4 py-2 rounded-md bg-wiki-accent/10 text-wiki-accent hover:bg-wiki-accent/20 text-sm font-medium transition-colors"
        >
          {t('insWikiRun')}
        </button>
        <span className="text-xs text-wiki-muted">{t('insWikiHint')}</span>
      </div>

      {plan && (
        <div className="space-y-2">
          {plan.fullRegenRecommended && (
            <div className="flex items-center gap-2 text-sm text-amber-500">
              <AlertTriangle size={14} /> {t('insWikiFull')}
            </div>
          )}
          {plan.affectedPages.length === 0 && !plan.fullRegenRecommended && (
            <p className="text-sm text-wiki-muted">{t('insWikiNone')}</p>
          )}
          {plan.affectedPages.length > 0 && (
            <>
              <div className="text-xs font-semibold text-wiki-muted">
                {t('insWikiAffected')}: {plan.affectedPages.length} / {plan.totalPages}
              </div>
              <div className="space-y-1">
                {plan.affectedPages.map(p => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-wiki-card border border-wiki-border text-sm">
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded shrink-0 ${
                      p.reason === 'direct' ? 'bg-wiki-accent/10 text-wiki-accent' : 'bg-amber-500/10 text-amber-500'
                    }`}>
                      {p.reason === 'direct' ? t('insWikiDirect') : t('insWikiTransitive')}
                    </span>
                    <span className="text-wiki-text font-medium">{p.title}</span>
                    <span className="text-xs text-wiki-muted truncate ml-auto">{p.changedSources.join(', ')}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Evaluation (eval-harness) -------------------------------------------

function EvalTool({ graph }: { graph: OntologyGraph }) {
  const [casesText, setCasesText] = useState('')
  const [baselineText, setBaselineText] = useState('')
  const [report, setReport] = useState<EvalReport | null>(null)
  const [regressions, setRegressions] = useState<Regression[] | null>(null)
  const [error, setError] = useState(false)

  const run = useCallback(() => {
    setError(false)
    setReport(null)
    setRegressions(null)
    let cases: EvalCase[]
    try {
      const parsed = JSON.parse(casesText)
      if (!Array.isArray(parsed)) throw new Error('not array')
      cases = parsed as EvalCase[]
    } catch {
      setError(true)
      return
    }
    const rep = runEval(graph, cases)
    setReport(rep)
    if (baselineText.trim()) {
      try {
        const baseline = JSON.parse(baselineText) as Record<string, number>
        setRegressions(compareToBaseline(rep, baseline).regressions)
      } catch {
        // ignore malformed baseline; report still shown
      }
    }
  }, [casesText, baselineText, graph])

  return (
    <div className="max-w-3xl space-y-4">
      <textarea
        value={casesText}
        onChange={e => setCasesText(e.target.value)}
        placeholder={t('insEvalPlaceholder')}
        rows={6}
        className="w-full px-3 py-2 rounded-md bg-wiki-card border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted focus:outline-none focus:border-wiki-accent font-mono"
      />
      <textarea
        value={baselineText}
        onChange={e => setBaselineText(e.target.value)}
        placeholder={t('insEvalBaselinePlaceholder')}
        rows={2}
        className="w-full px-3 py-2 rounded-md bg-wiki-card border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted focus:outline-none focus:border-wiki-accent font-mono"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          className="px-4 py-2 rounded-md bg-wiki-accent/10 text-wiki-accent hover:bg-wiki-accent/20 text-sm font-medium transition-colors"
        >
          {t('insEvalRun')}
        </button>
        <span className="text-xs text-wiki-muted">{t('insEvalHint')}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertTriangle size={14} /> {t('insEvalError')}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="bg-wiki-card border border-wiki-border rounded-md px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
            <span className="font-semibold text-wiki-text">{t('insEvalOverall')}</span>
            <span className="text-wiki-text">{t('insEvalPrecision')}: {pct(report.overall.precision)}</span>
            <span className="text-wiki-text">{t('insEvalRecall')}: {pct(report.overall.recall)}</span>
            <span className="text-wiki-text">{t('insEvalF1')}: {pct(report.overall.f1)}</span>
            <span className="text-wiki-muted">{t('insEvalCases')}: {report.overall.cases}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-wiki-muted border-b border-wiki-border">
                  <th className="py-1.5 pr-4">type</th>
                  <th className="py-1.5 pr-4">{t('insEvalCases')}</th>
                  <th className="py-1.5 pr-4">{t('insEvalPrecision')}</th>
                  <th className="py-1.5 pr-4">{t('insEvalRecall')}</th>
                  <th className="py-1.5 pr-4">{t('insEvalF1')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(report.categories).map(c => (
                  <tr key={c.type} className="border-b border-wiki-border/50">
                    <td className="py-1.5 pr-4 text-wiki-text font-medium">{c.type}</td>
                    <td className="py-1.5 pr-4 text-wiki-text">{c.cases}</td>
                    <td className="py-1.5 pr-4 text-wiki-text">{pct(c.precision)}</td>
                    <td className="py-1.5 pr-4 text-wiki-text">{pct(c.recall)}</td>
                    <td className="py-1.5 pr-4 text-wiki-text">{pct(c.f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {regressions !== null && (
            regressions.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle2 size={14} /> {t('insEvalNoRegressions')}
              </div>
            ) : (
              <div>
                <div className="text-xs font-semibold text-red-500 mb-1.5">{t('insEvalRegressions')}</div>
                <div className="space-y-1">
                  {regressions.map(r => (
                    <div key={r.category} className="flex items-center gap-2 text-sm text-wiki-text">
                      <AlertTriangle size={13} className="text-red-500" />
                      <span className="font-medium">{r.category}</span>
                      <span className="text-wiki-muted">{pct(r.baselineF1)} → {pct(r.currentF1)} ({pct(r.delta)})</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
