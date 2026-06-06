/**
 * Test Runner
 *
 * Runs a project's verification commands (tests / build / lint) in the project
 * directory and reports structured pass/fail results. This is the "verify" half
 * of an edit -> verify loop: after the Code Agent applies a patch, the user can
 * run the configured commands to confirm nothing broke (and feed failures back).
 *
 * Command execution is injected (`CommandExecutor`) so the service is
 * environment-agnostic and unit-testable. The app wires it to the Electron
 * `runCommand` bridge, which spawns the command in a child process with a
 * timeout. Only user-configured commands are ever run.
 */

export interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface CommandExecutor {
  run(opts: { cwd: string; command: string; timeoutMs: number }): Promise<CommandResult>
}

export interface VerifyStep {
  name: string
  command: string
}

export interface VerifyStepResult {
  name: string
  command: string
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  output: string
}

export interface VerifyResult {
  ok: boolean
  steps: VerifyStepResult[]
}

const MAX_OUTPUT = 8000

/** Keep the tail of combined output (failures show at the end of logs). */
export function tailOutput(stdout: string, stderr: string, max = MAX_OUTPUT): string {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trimEnd()
  if (combined.length <= max) return combined
  return '…(truncated)…\n' + combined.slice(combined.length - max)
}

export class TestRunner {
  constructor(private executor: CommandExecutor) {}

  /**
   * Run each step in order. By default stops at the first failure (a failed
   * build makes running tests pointless); pass `stopOnFailure: false` to run
   * every step regardless.
   */
  async verify(
    cwd: string,
    steps: VerifyStep[],
    timeoutMs: number,
    opts?: { stopOnFailure?: boolean },
  ): Promise<VerifyResult> {
    const stopOnFailure = opts?.stopOnFailure ?? true
    const results: VerifyStepResult[] = []

    for (const step of steps) {
      if (!step.command.trim()) continue
      const r = await this.executor.run({ cwd, command: step.command, timeoutMs })
      const ok = r.exitCode === 0 && !r.timedOut
      results.push({
        name: step.name,
        command: step.command,
        ok,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        output: tailOutput(r.stdout, r.stderr),
      })
      if (!ok && stopOnFailure) break
    }

    return { ok: results.length > 0 && results.every(s => s.ok), steps: results }
  }
}

/** Build the ordered verify steps from config, skipping empty commands. */
export function stepsFromConfig(cfg: { testCommand: string; buildCommand: string; lintCommand: string }): VerifyStep[] {
  const steps: VerifyStep[] = []
  if (cfg.lintCommand.trim()) steps.push({ name: 'Lint', command: cfg.lintCommand })
  if (cfg.buildCommand.trim()) steps.push({ name: 'Build', command: cfg.buildCommand })
  if (cfg.testCommand.trim()) steps.push({ name: 'Test', command: cfg.testCommand })
  return steps
}
