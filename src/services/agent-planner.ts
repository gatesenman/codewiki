/**
 * Code Agent Planner
 *
 * Turns the single-shot Code Agent into a multi-step loop:
 *
 *   analyze -> apply -> verify -> (on failure) roll back, feed the failure
 *   back into the next analysis, and retry — up to `maxIterations`.
 *
 * It also has a small cross-session **memory**: lessons from successful runs are
 * remembered and recalled into future analyses so the agent doesn't repeat
 * mistakes.
 *
 * Every collaborator is injected behind a narrow interface, so the loop is
 * environment-agnostic and unit-testable. The app wires:
 *   analyzer -> CodeAgent, patcher -> PatchService, verifier -> TestRunner,
 *   memory   -> LocalStorageMemory.
 */

import type { CodeModification } from '../types'
import type { RollbackToken } from './patch-service'
import type { VerifyResult } from './test-runner'

export interface PlannerAnalysis {
  analysis: string
  modifications: CodeModification[]
  warnings: string[]
}

export interface PlannerAnalyzer {
  /** `failureContext` carries verification failures / recalled memory. */
  analyze(request: string, failureContext?: string): Promise<PlannerAnalysis>
}

export interface PlannerPatcher {
  apply(mods: CodeModification[]): Promise<{ ok: boolean; rollback: RollbackToken; errors: string[] }>
  rollback(token: RollbackToken): Promise<{ ok: boolean; errors: string[] }>
}

export interface PlannerVerifier {
  verify(): Promise<VerifyResult>
}

export interface PlannerMemory {
  recall(request: string): Promise<string[]>
  remember(entry: { request: string; lesson: string }): Promise<void>
}

export type StepOutcome = 'verified' | 'applied' | 'verify-failed' | 'apply-failed' | 'no-changes'

export interface PlanStep {
  iteration: number
  analysis: string
  modifications: CodeModification[]
  applied: boolean
  applyErrors: string[]
  verify?: VerifyResult
  outcome: StepOutcome
}

export interface PlanRun {
  success: boolean
  steps: PlanStep[]
  /** Rollback token for changes left on disk after a successful run (else null). */
  rollback: RollbackToken | null
  summary: string
}

export interface PlannerDeps {
  analyzer: PlannerAnalyzer
  patcher: PlannerPatcher
  verifier?: PlannerVerifier
  memory?: PlannerMemory
}

export class CodeAgentPlanner {
  constructor(private deps: PlannerDeps) {}

  async run(request: string, opts?: { maxIterations?: number }): Promise<PlanRun> {
    const maxIterations = Math.max(1, opts?.maxIterations ?? 3)
    const steps: PlanStep[] = []

    let failureContext: string | undefined
    if (this.deps.memory) {
      const recalled = await this.deps.memory.recall(request)
      if (recalled.length) failureContext = 'Relevant lessons from past changes:\n' + recalled.join('\n')
    }

    for (let i = 0; i < maxIterations; i++) {
      const res = await this.deps.analyzer.analyze(request, failureContext)
      const step: PlanStep = {
        iteration: i, analysis: res.analysis, modifications: res.modifications,
        applied: false, applyErrors: [], outcome: 'no-changes',
      }

      if (!res.modifications.length) {
        steps.push(step)
        break
      }

      const applied = await this.deps.patcher.apply(res.modifications)
      if (!applied.ok) {
        step.outcome = 'apply-failed'
        step.applyErrors = applied.errors
        steps.push(step)
        failureContext = 'The previous patch could not be applied:\n' + applied.errors.join('\n')
        continue
      }
      step.applied = true

      // No verifier configured -> applying is the end state.
      if (!this.deps.verifier) {
        step.outcome = 'applied'
        steps.push(step)
        await this.commit(request, 'Applied (no verification configured): ' + res.analysis.slice(0, 200))
        return { success: true, steps, rollback: applied.rollback, summary: 'Applied changes (no verifier configured).' }
      }

      const verify = await this.deps.verifier.verify()
      step.verify = verify
      if (verify.ok) {
        step.outcome = 'verified'
        steps.push(step)
        await this.commit(request, 'Verified solution: ' + res.analysis.slice(0, 200))
        return { success: true, steps, rollback: applied.rollback, summary: `Verified after ${i + 1} iteration(s).` }
      }

      // Verification failed -> roll back and retry with the failure as context.
      step.outcome = 'verify-failed'
      steps.push(step)
      await this.deps.patcher.rollback(applied.rollback)
      const failing = verify.steps.filter(s => !s.ok)
      failureContext = 'The previous attempt was applied but FAILED verification and was rolled back. '
        + 'Produce a corrected patch that fixes these failures:\n\n'
        + failing.map(s => `### ${s.name} (${s.command})\n${s.output}`).join('\n\n')
    }

    return {
      success: false,
      steps,
      rollback: null,
      summary: `Could not reach a verified solution in ${maxIterations} iteration(s); all changes were rolled back.`,
    }
  }

  private async commit(request: string, lesson: string): Promise<void> {
    if (this.deps.memory) await this.deps.memory.remember({ request, lesson })
  }
}

/**
 * Memory backed by the renderer's localStorage. Recall is a simple token
 * overlap against past requests/lessons — enough to surface relevant prior
 * constraints without any external service.
 */
export class LocalStorageMemory implements PlannerMemory {
  constructor(private key = 'codewiki:agent-memory', private max = 50) {}

  private read(): { request: string; lesson: string; ts: number }[] {
    try {
      if (typeof localStorage === 'undefined') return []
      return JSON.parse(localStorage.getItem(this.key) || '[]')
    } catch {
      return []
    }
  }

  async recall(request: string): Promise<string[]> {
    const terms = request.toLowerCase().split(/\s+/).filter(t => t.length > 3)
    if (!terms.length) return []
    return this.read()
      .filter(e => terms.some(t => e.request.toLowerCase().includes(t) || e.lesson.toLowerCase().includes(t)))
      .slice(-5)
      .map(e => '- ' + e.lesson)
  }

  async remember(entry: { request: string; lesson: string }): Promise<void> {
    if (typeof localStorage === 'undefined') return
    const all = this.read()
    all.push({ ...entry, ts: Date.now() })
    localStorage.setItem(this.key, JSON.stringify(all.slice(-this.max)))
  }
}
