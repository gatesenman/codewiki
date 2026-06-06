/**
 * Lightweight security findings scanner (CodeFlow-inspired).
 *
 * Complements privacy-filter's *redaction* with *reporting*: surfaces likely
 * risk hotspots (hardcoded secrets, dangerous eval, SQL string concatenation,
 * shell injection, production debug statements) so humans and the agent can see
 * what to harden before modifying. Pure (files in → findings out), regex-based,
 * conservative; no execution, no network.
 */

export type Severity = 'high' | 'medium' | 'low'

export interface SecurityFinding {
  file: string
  line: number
  rule: string
  severity: Severity
  message: string
  /** The matched source line (trimmed, secrets masked). */
  snippet: string
}

export interface SecurityReport {
  findings: SecurityFinding[]
  bySeverity: { high: number; medium: number; low: number }
  byRule: Record<string, number>
  filesScanned: number
}

interface Rule {
  id: string
  severity: Severity
  message: string
  /** Must be global+multiline-safe; tested per line. */
  test: RegExp
  /** Skip comment-only matches when true (default true). */
  skipComments?: boolean
  /** When true, mask the matched value in the snippet. */
  maskSnippet?: boolean
}

const RULES: Rule[] = [
  {
    id: 'hardcoded-secret',
    severity: 'high',
    message: 'Possible hardcoded secret / credential assigned in source',
    test: /(?:secret|token|password|passwd|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token)\s*[:=]\s*["'][^"']{6,}["']/i,
    maskSnippet: true,
  },
  {
    id: 'known-token',
    severity: 'high',
    message: 'Hardcoded provider token (GitHub/OpenAI/AWS/Slack) detected',
    test: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    maskSnippet: true,
    skipComments: false,
  },
  {
    id: 'private-key',
    severity: 'high',
    message: 'Embedded private key block',
    test: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    skipComments: false,
  },
  {
    id: 'eval-usage',
    severity: 'high',
    message: 'Use of eval() can execute arbitrary code',
    test: /\beval\s*\(/,
  },
  {
    id: 'function-constructor',
    severity: 'medium',
    message: 'Function constructor behaves like eval()',
    test: /\bnew\s+Function\s*\(/,
  },
  {
    id: 'sql-injection',
    severity: 'high',
    message: 'SQL string built via concatenation/interpolation (injection risk)',
    test: /(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*?(?:["'`]\s*\+|\$\{|%s|\+\s*["'`])/i,
  },
  {
    id: 'shell-injection',
    severity: 'high',
    message: 'Shell command built with concatenation/interpolation',
    test: /\b(?:exec|execSync|spawnSync|popen|system|os\.system|subprocess\.(?:call|run|Popen))\s*\([^)]*(?:\+|\$\{|%\s|`[^`]*\$\{)/,
  },
  {
    id: 'dangerous-html',
    severity: 'medium',
    message: 'innerHTML / dangerouslySetInnerHTML can enable XSS',
    test: /(?:\.innerHTML\s*=|dangerouslySetInnerHTML)/,
  },
  {
    id: 'debug-statement',
    severity: 'low',
    message: 'Debug statement left in code',
    test: /\b(?:console\.(?:log|debug|trace)|debugger|System\.out\.println|fmt\.Println)\b/,
  },
  {
    id: 'insecure-random',
    severity: 'low',
    message: 'Math.random() is not cryptographically secure',
    test: /\bMath\.random\s*\(/,
  },
  {
    id: 'http-url',
    severity: 'low',
    message: 'Cleartext http:// URL (prefer https)',
    test: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
  },
]

const COMMENT_LINE = /^\s*(?:\/\/|#|\*|<!--)/

function maskValue(line: string): string {
  return line
    .replace(/(["'])([^"']{6,})\1/g, (_m, q) => `${q}***${q}`)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|sk-[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{6,}|xox[baprs]-[A-Za-z0-9-]{6,})\b/g, '***')
}

/** Files whose findings are noise (tests, fixtures, vendored). */
function isNoiseFile(path: string): boolean {
  return /(^|\/)(node_modules|dist|build|out|vendor|\.min\.)/.test(path) ||
    /\.(test|spec)\.[tj]sx?$/.test(path)
}

export interface ScanInput {
  path: string
  content: string
}

export function scanSecurity(files: ScanInput[]): SecurityReport {
  const findings: SecurityFinding[] = []
  let scanned = 0

  for (const f of files) {
    if (!f.content || isNoiseFile(f.path)) continue
    scanned++
    const lines = f.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 1000) continue // skip minified/huge lines
      const isComment = COMMENT_LINE.test(line)
      for (const rule of RULES) {
        if (isComment && rule.skipComments !== false) continue
        if (rule.test.test(line)) {
          const raw = line.trim().slice(0, 200)
          findings.push({
            file: f.path,
            line: i + 1,
            rule: rule.id,
            severity: rule.severity,
            message: rule.message,
            snippet: rule.maskSnippet ? maskValue(raw) : raw,
          })
        }
      }
    }
  }

  const bySeverity = { high: 0, medium: 0, low: 0 }
  const byRule: Record<string, number> = {}
  for (const find of findings) {
    bySeverity[find.severity]++
    byRule[find.rule] = (byRule[find.rule] || 0) + 1
  }

  // High severity first, then by file/line.
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)

  return { findings, bySeverity, byRule, filesScanned: scanned }
}
