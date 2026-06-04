import { useState } from 'react'
import {
  Bot, Send, AlertTriangle, FileText, CheckCircle2,
  Loader2, GitBranch, Code, Shield,
} from 'lucide-react'
import { useAppStore } from '../store'
import { services } from '../services/service-registry'
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
  useAppStore(s => s.locale)
  const [request, setRequest] = useState('')
  const [result, setResult] = useState<AgentResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [appliedMods, setAppliedMods] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const handleApplyModification = async (mod: CodeModification, index: number) => {
    if (!window.electronAPI?.applyModification) return
    setApplying(true)
    try {
      const result = await window.electronAPI.applyModification(
        mod.filePath, mod.startLine, mod.endLine,
        mod.newContent, mod.originalContent,
      )
      if (result.success) {
        setAppliedMods(prev => new Set(prev).add(index))
      } else {
        setError(`${t('agentFailedToApply')}${result.error}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agentApplyFailed'))
    } finally {
      setApplying(false)
    }
  }

  const handleApplyAll = async () => {
    if (!result) return
    for (let i = 0; i < result.modifications.length; i++) {
      if (!appliedMods.has(i)) {
        await handleApplyModification(result.modifications[i], i)
      }
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
          <button
            onClick={handleAnalyze}
            disabled={loading || !request.trim() || !currentProject}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-wiki-green/15 text-wiki-green text-sm font-medium hover:bg-wiki-green/25 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {loading ? t('agentAnalyzing') : t('agentAnalyzePlan')}
          </button>
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
                  <button
                    onClick={handleApplyAll}
                    disabled={applying || appliedMods.size === result.modifications.length}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wiki-green/15 text-wiki-green text-xs font-medium hover:bg-wiki-green/25 disabled:opacity-50 transition-colors"
                  >
                    {applying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    {t('agentApplyAll')} ({result.modifications.length - appliedMods.size} {t('agentRemaining')})
                  </button>
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

            {/* Warnings */}
            {result.warnings.length > 0 && (
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
