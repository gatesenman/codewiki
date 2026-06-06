import { useState } from 'react'
import {
  Bot, Send, AlertTriangle, FileText, CheckCircle2,
  Loader2, GitBranch, Code, Shield, Undo2, PlayCircle, XCircle, Wand2,
} from 'lucide-react'
import { useAppStore } from '../store'
import { services } from '../services/service-registry'
import { PatchService, type PatchIO, type RollbackToken } from '../services/patch-service'
import { TestRunner, stepsFromConfig, type CommandExecutor, type VerifyResult } from '../services/test-runner'
import { CodeAgentPlanner, LocalStorageMemory, type PlannerAnalyzer, type PlannerVerifier, type PlanRun } from '../services/agent-planner'
import { t } from '../services/i18n'
import type { CodeModification } from '../types'

interface AgentResult {
  analysis: string
  modifications: CodeModification[]
  impactedFiles: string[]
  warnings: string[]
}

export function CodeAgentPanel() {
  const { currentProject, settings } = useAppStore()
  const verifyConfig = useAppStore(s => s.config.verify)
  const confirmBeforeApply = useAppStore(s => s.config.behavior.confirmBeforeApply)
  const showImpactWarning = useAppStore(s => s.config.notifications.showImpactWarning)
  useAppStore(s => s.locale)
  const [request, setRequest] = useState('')
  const [result, setResult] = useState<AgentResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [appliedMods, setAppliedMods] = useState<Set<number>>(new Set())
  const [rollbackToken, setRollbackToken] = useState<RollbackToken | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planRun, setPlanRun] = useState<PlanRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const verifySteps = stepsFromConfig(verifyConfig)
  const canVerify = verifyConfig.enabled && verifySteps.length > 0 &&
    currentProject?.type === 'local' && !!currentProject?.path

  const handleVerify = async () => {
    const api = window.electronAPI
    if (!canVerify || !api?.runCommand || !currentProject?.path) return
    const executor: CommandExecutor = {
      run: ({ cwd, command, timeoutMs }) => api.runCommand(cwd, command, timeoutMs),
    }
    setVerifying(true)
    setError(null)
    setVerifyResult(null)
    try {
      const runner = new TestRunner(executor)
      const res = await runner.verify(currentProject.path, verifySteps, verifyConfig.timeoutMs)
      setVerifyResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verify failed')
    } finally {
      setVerifying(false)
    }
  }

  const getPatchService = (): PatchService | null => {
    const api = window.electronAPI
    if (!api?.readFile || !api?.writeFile) return null
    const io: PatchIO = {
      readFile: api.readFile,
      writeFile: api.writeFile,
    }
    return new PatchService(io)
  }

  // Apply a subset of modifications atomically (all-or-nothing).
  const applyMods = async (indices: number[]) => {
    if (!result || indices.length === 0) return
    // Optional confirmation gate before mutating files on disk.
    if (confirmBeforeApply) {
      const files = [...new Set(indices.map(i => result.modifications[i]?.filePath).filter(Boolean))]
      const ok = window.confirm(
        `${t('agentConfirmApply')}\n\n${files.join('\n')}`
      )
      if (!ok) return
    }
    const patch = getPatchService()
    if (!patch) { setError('File system bridge unavailable.'); return }
    setApplying(true)
    setError(null)
    try {
      const mods = indices.map(i => result.modifications[i])
      const res = await patch.apply(mods)
      if (res.ok) {
        setAppliedMods(prev => {
          const next = new Set(prev)
          for (const i of indices) next.add(i)
          return next
        })
        // Accumulate rollback info, preserving the earliest captured original.
        setRollbackToken(prev => {
          const merged: RollbackToken = { ...res.rollback, ...(prev || {}) }
          return merged
        })
      } else {
        setError(`${t('agentFailedToApply')}${res.errors.join('; ')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agentApplyFailed'))
    } finally {
      setApplying(false)
    }
  }

  const handleApplyModification = (_mod: CodeModification, index: number) => applyMods([index])

  const handleApplyAll = () => {
    if (!result) return
    const remaining = result.modifications.map((_, i) => i).filter(i => !appliedMods.has(i))
    void applyMods(remaining)
  }

  const handleRollback = async () => {
    if (!rollbackToken) return
    const patch = getPatchService()
    if (!patch) { setError('File system bridge unavailable.'); return }
    setApplying(true)
    setError(null)
    try {
      const res = await patch.rollback(rollbackToken)
      if (res.ok) {
        setAppliedMods(new Set())
        setRollbackToken(null)
      } else {
        setError(`Rollback failed: ${res.errors.join('; ')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed')
    } finally {
      setApplying(false)
    }
  }

  const handleAnalyze = async () => {
    if (!request.trim() || !currentProject) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const agent = services.getCodeAgent(settings)
      const readFile = (path: string) => window.electronAPI.readFile(path)

      const agentResult = await agent.analyzeModification(
        request.trim(),
        currentProject.ontologyGraph,
        readFile,
      )
      setResult(agentResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agentAnalysisFailed'))
    } finally {
      setLoading(false)
    }
  }

  // Auto-fix: analyze -> apply -> verify -> (on failure) roll back & retry.
  const handlePlan = async () => {
    if (!request.trim() || !currentProject) return
    const patch = getPatchService()
    if (!patch) { setError('File system bridge unavailable.'); return }
    setPlanning(true)
    setError(null)
    setResult(null)
    setVerifyResult(null)
    setPlanRun(null)
    setRollbackToken(null)
    setAppliedMods(new Set())
    try {
      const agent = services.getCodeAgent(settings)
      const readFile = (path: string) => window.electronAPI.readFile(path)
      const analyzer: PlannerAnalyzer = {
        analyze: async (req, ctx) => {
          const full = ctx ? `${req}\n\n--- Additional context ---\n${ctx}` : req
          const r = await agent.analyzeModification(full, currentProject.ontologyGraph, readFile)
          return { analysis: r.analysis, modifications: r.modifications, warnings: r.warnings }
        },
      }
      const api = window.electronAPI
      const verifier: PlannerVerifier | undefined = canVerify
        ? {
            verify: () => new TestRunner({
              run: ({ cwd, command, timeoutMs }) => api.runCommand(cwd, command, timeoutMs),
            }).verify(currentProject.path as string, verifySteps, verifyConfig.timeoutMs),
          }
        : undefined

      const planner = new CodeAgentPlanner({ analyzer, patcher: patch, verifier, memory: new LocalStorageMemory() })
      const run = await planner.run(request.trim(), { maxIterations: 3 })
      setPlanRun(run)

      const last = run.steps[run.steps.length - 1]
      if (last) {
        setResult({ analysis: last.analysis, modifications: last.modifications, impactedFiles: [], warnings: [] })
        if (last.verify) setVerifyResult(last.verify)
      }
      if (run.success && run.rollback) {
        setRollbackToken(run.rollback)
        if (last) setAppliedMods(new Set(last.modifications.map((_, i) => i)))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-fix failed')
    } finally {
      setPlanning(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-wiki-border bg-wiki-sidebar">
        <div className="flex items-center gap-2 mb-2">
          <Bot size={18} className="text-wiki-green" />
          <h2 className="text-sm font-semibold">{t('agentTitle')}</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-wiki-green/10 text-wiki-green border border-wiki-green/20">
            {t('agentBadge')}
          </span>
        </div>
        <p className="text-xs text-wiki-muted">
          {t('agentHeaderDesc')}
        </p>
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-b border-wiki-border">
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder={t('agentPlaceholder')}
          rows={3}
          className="w-full px-4 py-3 rounded-lg bg-wiki-bg border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent resize-none"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2 text-[10px] text-wiki-muted">
            <Shield size={12} />
            <span>
              {currentProject?.ontologyGraph.entities.length || 0} {t('footerEntities')} &bull;{' '}
              {currentProject?.ontologyGraph.relations.length || 0} {t('footerRelations')} {t('agentInKnowledgeGraph')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePlan}
              disabled={planning || loading || !request.trim() || currentProject?.type !== 'local'}
              title={canVerify ? t('agentAutoFixTitleVerify') : t('agentAutoFixTitlePlain')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-wiki-accent/15 text-wiki-accent text-sm font-medium hover:bg-wiki-accent/25 disabled:opacity-50 transition-colors"
            >
              {planning ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {planning ? t('agentWorking') : t('agentAutoFix')}
            </button>
            <button
              onClick={handleAnalyze}
              disabled={loading || planning || !request.trim() || !currentProject}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-wiki-green/15 text-wiki-green text-sm font-medium hover:bg-wiki-green/25 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {loading ? t('agentAnalyzing') : t('agentAnalyzePlan')}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle size={16} />
              {error}
            </div>
          </div>
        )}

        {planRun && (
          <div className={`mb-4 p-4 rounded-lg border ${planRun.success ? 'border-wiki-green/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
            <div className="flex items-center gap-2 text-sm font-semibold mb-2">
              {planRun.success
                ? <CheckCircle2 size={16} className="text-wiki-green" />
                : <XCircle size={16} className="text-red-400" />}
              <span className={planRun.success ? 'text-wiki-green' : 'text-red-400'}>Auto-fix: {planRun.summary}</span>
            </div>
            <ol className="space-y-1.5">
              {planRun.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-wiki-muted">
                  <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-wiki-card border border-wiki-border flex items-center justify-center text-[10px] text-wiki-text">{i + 1}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    s.outcome === 'verified' || s.outcome === 'applied'
                      ? 'bg-wiki-green/15 text-wiki-green'
                      : s.outcome === 'no-changes'
                        ? 'bg-wiki-card text-wiki-muted'
                        : 'bg-red-500/15 text-red-400'
                  }`}>
                    {s.outcome}
                  </span>
                  <span className="text-wiki-text/80">{s.analysis.slice(0, 160)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {result && (
          <div className="space-y-6">
            {/* Analysis */}
            <div>
              <h3 className="text-sm font-semibold text-wiki-text mb-2 flex items-center gap-2">
                <Code size={14} />
                {t('agentAnalysisTitle')}
              </h3>
              <div className="p-4 rounded-lg bg-wiki-card border border-wiki-border text-sm text-wiki-text/90 whitespace-pre-wrap">
                {result.analysis}
              </div>
            </div>

            {/* Impacted files */}
            {result.impactedFiles.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-wiki-text mb-2 flex items-center gap-2">
                  <GitBranch size={14} />
                  {t('agentImpactedFiles')} ({result.impactedFiles.length})
                </h3>
                <div className="space-y-1">
                  {result.impactedFiles.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded bg-wiki-card/50 border border-wiki-border text-xs">
                      <FileText size={12} className="text-wiki-muted" />
                      <span className="font-mono text-wiki-text">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modifications */}
            {result.modifications.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-wiki-text flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-wiki-green" />
                    {t('agentProposedMods')} ({result.modifications.length})
                  </h3>
                  <div className="flex items-center gap-2">
                    {canVerify && (
                      <button
                        onClick={handleVerify}
                        disabled={verifying || applying}
                        title={`${t('agentVerifyRun')}${verifySteps.map(s => s.command).join(' && ')}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wiki-accent/15 text-wiki-accent text-xs font-medium hover:bg-wiki-accent/25 disabled:opacity-50 transition-colors"
                      >
                        {verifying ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
                        {t('agentVerify')}
                      </button>
                    )}
                    {rollbackToken && Object.keys(rollbackToken).length > 0 && (
                      <button
                        onClick={handleRollback}
                        disabled={applying}
                        title={t('agentRollbackTitle')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wiki-orange/15 text-wiki-orange text-xs font-medium hover:bg-wiki-orange/25 disabled:opacity-50 transition-colors"
                      >
                        {applying ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                        {t('agentRollback')} ({Object.keys(rollbackToken).length})
                      </button>
                    )}
                    <button
                      onClick={handleApplyAll}
                      disabled={applying || appliedMods.size === result.modifications.length}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wiki-green/15 text-wiki-green text-xs font-medium hover:bg-wiki-green/25 disabled:opacity-50 transition-colors"
                    >
                      {applying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      {t('agentApplyAll')} ({result.modifications.length - appliedMods.size} {t('agentRemaining')})
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {result.modifications.map((mod, i) => (
                    <div key={i} className={`rounded-lg border overflow-hidden ${appliedMods.has(i) ? 'border-wiki-green/30 bg-green-500/5' : 'border-wiki-border'}`}>
                      <div className="px-3 py-2 bg-wiki-card border-b border-wiki-border flex items-center gap-2">
                        <FileText size={12} className="text-wiki-muted" />
                        <span className="text-xs font-mono text-wiki-text">{mod.filePath}</span>
                        <span className="text-[10px] text-wiki-muted">
                          {t('agentLinesLabel')} {mod.startLine}-{mod.endLine}
                        </span>
                        <span className="flex-1" />
                        {appliedMods.has(i) ? (
                          <span className="text-[10px] text-wiki-green flex items-center gap-1">
                            <CheckCircle2 size={10} /> {t('agentApplied')}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleApplyModification(mod, i)}
                            disabled={applying}
                            className="text-[10px] px-2 py-1 rounded bg-wiki-accent/15 text-wiki-accent hover:bg-wiki-accent/25 disabled:opacity-50 transition-colors"
                          >
                            {t('agentApply')}
                          </button>
                        )}
                      </div>
                      <div className="p-3 text-xs text-wiki-muted">
                        {mod.description}
                      </div>
                      {mod.originalContent && (
                        <div className="border-t border-wiki-border">
                          <div className="px-3 py-1 text-[10px] text-red-400 bg-red-500/5">- {t('agentOriginal')}</div>
                          <pre className="px-3 py-2 text-xs text-red-400/80 bg-red-500/5 overflow-x-auto">
                            <code>{mod.originalContent}</code>
                          </pre>
                        </div>
                      )}
                      {mod.newContent && (
                        <div className="border-t border-wiki-border">
                          <div className="px-3 py-1 text-[10px] text-wiki-green bg-green-500/5">+ {t('agentModified')}</div>
                          <pre className="px-3 py-2 text-xs text-wiki-green/80 bg-green-500/5 overflow-x-auto">
                            <code>{mod.newContent}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Verification results */}
            {verifyResult && (
              <div>
                <h3 className="text-sm font-semibold text-wiki-text mb-2 flex items-center gap-2">
                  {verifyResult.ok
                    ? <CheckCircle2 size={14} className="text-wiki-green" />
                    : <XCircle size={14} className="text-red-400" />}
                  Verification {verifyResult.ok ? 'passed' : 'failed'}
                </h3>
                <div className="space-y-2">
                  {verifyResult.steps.map((step, i) => (
                    <div key={i} className={`rounded-lg border overflow-hidden ${step.ok ? 'border-wiki-green/30' : 'border-red-500/30'}`}>
                      <div className="px-3 py-2 bg-wiki-card border-b border-wiki-border flex items-center gap-2">
                        {step.ok
                          ? <CheckCircle2 size={12} className="text-wiki-green" />
                          : <XCircle size={12} className="text-red-400" />}
                        <span className="text-xs font-medium text-wiki-text">{step.name}</span>
                        <span className="text-[10px] font-mono text-wiki-muted">{step.command}</span>
                        <span className="flex-1" />
                        <span className="text-[10px] text-wiki-muted">
                          {step.timedOut ? 'timed out' : `exit ${step.exitCode}`}
                        </span>
                      </div>
                      {step.output && (
                        <pre className="px-3 py-2 text-[11px] text-wiki-muted bg-wiki-card/40 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                          <code>{step.output}</code>
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {showImpactWarning && result.warnings.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-wiki-orange mb-2 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {t('agentWarnings')}
                </h3>
                <div className="space-y-2">
                  {result.warnings.map((warning, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-wiki-orange">
                      {warning}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-12 text-wiki-muted">
            <Bot size={40} className="mx-auto mb-3 text-wiki-muted/30" />
            <h3 className="text-sm font-medium mb-2">{t('agentEmptyTitle')}</h3>
            <p className="text-xs text-wiki-muted/60 max-w-md mx-auto mb-6">
              {t('agentEmptyDesc')}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                t('agentSuggestion1'),
                t('agentSuggestion2'),
                t('agentSuggestion3'),
                t('agentSuggestion4'),
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => setRequest(suggestion)}
                  className="px-3 py-1.5 rounded-lg border border-wiki-border text-xs text-wiki-muted hover:text-wiki-text hover:border-wiki-accent/30 transition-colors text-left"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
