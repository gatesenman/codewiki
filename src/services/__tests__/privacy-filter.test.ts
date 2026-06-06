import { describe, it, expect } from 'vitest'
import {
  parseIgnore,
  isIgnored,
  createPrivacyFilter,
  redactSecrets,
  DEFAULT_SENSITIVE_GLOBS,
} from '../privacy-filter'

describe('parseIgnore', () => {
  it('parses empty/null input without error', () => {
    expect(parseIgnore(null)).toBeInstanceOf(Array)
    expect(parseIgnore(undefined)).toBeInstanceOf(Array)
    expect(parseIgnore('')).toBeInstanceOf(Array)
  })

  it('includes default sensitive globs by default', () => {
    const rules = parseIgnore(null)
    expect(rules.length).toBeGreaterThan(0)
  })

  it('skips defaults when excludeSensitiveDefaults is false', () => {
    const rules = parseIgnore(null, { excludeSensitiveDefaults: false, useIgnoreFile: false })
    expect(rules).toHaveLength(0)
  })

  it('parses user ignore lines', () => {
    const rules = parseIgnore('build/\n*.log\n# comment\n', { excludeSensitiveDefaults: false })
    expect(rules).toHaveLength(2)
  })
})

describe('isIgnored', () => {
  it('ignores .env files by default', () => {
    const rules = parseIgnore(null)
    expect(isIgnored('.env', rules)).toBe(true)
    expect(isIgnored('config/.env', rules)).toBe(true)
  })

  it('allows .env.example', () => {
    const rules = parseIgnore(null)
    expect(isIgnored('.env.example', rules)).toBe(false)
  })

  it('ignores PEM files by default', () => {
    const rules = parseIgnore(null)
    expect(isIgnored('certs/server.pem', rules)).toBe(true)
    expect(isIgnored('id_rsa', rules)).toBe(true)
  })

  it('respects user-defined ignore patterns', () => {
    const rules = parseIgnore('temp/', { excludeSensitiveDefaults: false })
    expect(isIgnored('temp/cache.json', rules)).toBe(true)
  })

  it('supports negation rules', () => {
    const rules = parseIgnore('*.log\n!important.log', { excludeSensitiveDefaults: false })
    expect(isIgnored('debug.log', rules)).toBe(true)
    expect(isIgnored('important.log', rules)).toBe(false)
  })
})

describe('createPrivacyFilter', () => {
  it('creates a filter with isIgnored and redact', () => {
    const filter = createPrivacyFilter(null)
    expect(typeof filter.isIgnored).toBe('function')
    expect(typeof filter.redact).toBe('function')
  })

  it('filter ignores .env', () => {
    const filter = createPrivacyFilter(null)
    expect(filter.isIgnored('.env')).toBe(true)
  })

  it('filter redacts secrets by default', () => {
    const filter = createPrivacyFilter(null)
    const input = 'API_KEY="sk-abcdef1234567890abcdef"'
    expect(filter.redact(input)).toContain('[REDACTED]')
  })

  it('filter skips redaction when disabled', () => {
    const filter = createPrivacyFilter(null, { redactSecrets: false })
    const input = 'API_KEY="sk-abcdef1234567890abcdef"'
    expect(filter.redact(input)).toBe(input)
  })
})

describe('redactSecrets', () => {
  it('returns empty/null content unchanged', () => {
    expect(redactSecrets('')).toBe('')
  })

  it('redacts PEM private keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----'
    const result = redactSecrets(pem)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('MIIEpA')
  })

  it('redacts GitHub tokens', () => {
    const code = 'const token = "ghp_abcdefghijklmnopqrstuvwx"'
    expect(redactSecrets(code)).toContain('[REDACTED]')
  })

  it('redacts OpenAI-style keys', () => {
    const code = 'key = "sk-abcdefghijklmnopqrstuvwxyz123456"'
    expect(redactSecrets(code)).toContain('[REDACTED]')
  })

  it('redacts AWS access key IDs', () => {
    const code = 'accessKey = AKIAIOSFODNN7EXAMPLE'
    expect(redactSecrets(code)).toContain('[REDACTED]')
  })

  it('redacts env-style secret assignments', () => {
    const env = 'API_SECRET="my-super-secret-value"\nDB_PASSWORD=hunter2longpassword'
    const result = redactSecrets(env)
    expect(result).not.toContain('my-super-secret-value')
    expect(result).not.toContain('hunter2longpassword')
  })

  it('leaves non-secret content unchanged', () => {
    const code = 'const x = 42\nconst name = "hello"\n'
    expect(redactSecrets(code)).toBe(code)
  })
})
