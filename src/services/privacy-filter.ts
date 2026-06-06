/**
 * Privacy / access filter (P3 — trust & permissions).
 *
 * Two concerns, both pure and dependency-free so they run in the renderer and
 * are unit-testable:
 *   1. `.codewikiignore` (gitignore-style) — files/dirs the user never wants
 *      indexed, fed to the LLM, or exposed over MCP.
 *   2. Secret redaction — even for indexed files, mask obvious credentials
 *      (.env values, API keys, private keys, tokens) before the content leaves
 *      the machine boundary (embeddings/LLM/MCP responses).
 *
 * Default-sensitive files (.env, *.pem, id_rsa, ...) are always treated as
 * ignored even without a `.codewikiignore`.
 */

/** Files that are sensitive by default and should never be indexed. */
export const DEFAULT_SENSITIVE_GLOBS = [
  '.env', '.env.*', '*.pem', '*.key', '*.pfx', '*.p12',
  'id_rsa', 'id_dsa', 'id_ed25519', '*.keystore', '*.jks',
  'credentials.json', '*credentials*', '*secret*', '.npmrc', '.pypirc',
]
// .env.example is safe and commonly committed — never treat it as sensitive.
const SENSITIVE_ALLOW = ['.env.example', '.env.sample', '.env.template']

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')

interface IgnoreRule {
  self: RegExp  // matches the path itself
  under: RegExp // matches a path that lives under this one
  negated: boolean
  dirOnly: boolean
}

/**
 * Translate a single gitignore-style glob into a RegExp matching a relative
 * posix path. Supports `*`, `**`, `?`, leading `/` anchor, trailing `/` dir,
 * and a bare name matching at any depth.
 */
function globToRegExp(glob: string): { body: string; dirOnly: boolean } {
  let g = glob.trim()
  const dirOnly = g.endsWith('/')
  if (dirOnly) g = g.slice(0, -1)
  const anchored = g.startsWith('/')
  if (anchored) g = g.slice(1)

  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        // ** -> any number of path segments
        re += '.*'
        i++
        if (g[i + 1] === '/') i++ // consume the slash after **
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }

  // Bare names (no slash) match at any depth; anchored ones match from root.
  const body = anchored || g.includes('/') ? `^${re}` : `(^|.*/)${re}`
  return { body, dirOnly }
}

/** Parse `.codewikiignore` text plus default sensitive globs into rules. */
export function parseIgnore(text: string | null | undefined): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  const add = (line: string) => {
    let l = line.trim()
    if (!l || l.startsWith('#')) return
    const negated = l.startsWith('!')
    if (negated) l = l.slice(1)
    const { body, dirOnly } = globToRegExp(l)
    rules.push({ self: new RegExp(body + '$'), under: new RegExp(body + '/'), negated, dirOnly })
  }
  for (const g of DEFAULT_SENSITIVE_GLOBS) add(g)
  if (text) for (const line of text.split('\n')) add(line)
  return rules
}

/**
 * gitignore semantics: the last matching rule wins; a trailing `!` un-ignores.
 * `isDir` lets directory-only rules (`foo/`) match directories.
 */
export function isIgnored(relativePath: string, rules: IgnoreRule[], isDir = false): boolean {
  const p = norm(relativePath)
  // Common safe example files are never sensitive.
  if (SENSITIVE_ALLOW.includes(p.split('/').pop() || '')) return false
  let ignored = false
  for (const rule of rules) {
    // A dir-only rule (`foo/`) matches the directory itself only when it is a
    // directory, but always matches anything that lives under it.
    const matched = rule.dirOnly
      ? (isDir && rule.self.test(p)) || rule.under.test(p)
      : rule.self.test(p) || rule.under.test(p)
    if (matched) ignored = !rule.negated
  }
  return ignored
}

export interface PrivacyFilter {
  isIgnored: (relativePath: string, isDir?: boolean) => boolean
  redact: (content: string) => string
}

/** Build a reusable filter from `.codewikiignore` content. */
export function createPrivacyFilter(ignoreText: string | null | undefined): PrivacyFilter {
  const rules = parseIgnore(ignoreText)
  return {
    isIgnored: (rp, isDir = false) => isIgnored(rp, rules, isDir),
    redact: redactSecrets,
  }
}

const REDACTION = '[REDACTED]'

/**
 * Mask obvious secrets in file content. Conservative: targets high-confidence
 * patterns (assignments to key/token/secret/password vars, PEM blocks, known
 * key prefixes) so source logic stays readable.
 */
export function redactSecrets(content: string): string {
  if (!content) return content
  let out = content

  // PEM private key blocks.
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    `-----BEGIN PRIVATE KEY-----\n${REDACTION}\n-----END PRIVATE KEY-----`,
  )

  // KEY = "value" / KEY: value  for secret-ish identifiers (.env, configs).
  out = out.replace(
    /(^|\n)([ \t]*(?:export[ \t]+)?[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH)[A-Za-z0-9_]*)([ \t]*[:=][ \t]*)(["']?)([^\n"']+)(\4)/gi,
    (_m, lead, key, sep, q) => `${lead}${key}${sep}${q}${REDACTION}${q}`,
  )

  // Well-known token shapes.
  out = out
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, REDACTION) // GitHub tokens
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTION) // GitHub fine-grained PAT
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, REDACTION) // OpenAI-style keys
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTION) // AWS access key id
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTION) // Slack tokens

  return out
}

/** Convenience: should this file's *content* be redacted before leaving the box. */
export const CODEWIKIIGNORE_FILE = '.codewikiignore'
