import { describe, it, expect } from 'vitest'
import { scanSecurity } from '../security-scan'

describe('scanSecurity', () => {
  it('returns empty report for empty input', () => {
    const report = scanSecurity([])
    expect(report.findings).toHaveLength(0)
    expect(report.filesScanned).toBe(0)
  })

  it('returns clean report for safe code', () => {
    const report = scanSecurity([{
      path: 'src/app.ts',
      content: 'const x = 1\nconst y = x + 2\n',
    }])
    expect(report.findings).toHaveLength(0)
    expect(report.filesScanned).toBe(1)
  })

  it('detects hardcoded secrets', () => {
    const report = scanSecurity([{
      path: 'src/config.ts',
      content: 'const api_key = "sk-abc123456789abcdef"\n',
    }])
    expect(report.findings.length).toBeGreaterThan(0)
    expect(report.findings[0].severity).toBe('high')
    expect(report.findings[0].rule).toBe('hardcoded-secret')
  })

  it('detects eval usage', () => {
    const report = scanSecurity([{
      path: 'src/eval.ts',
      content: 'const result = eval(userInput)\n',
    }])
    const evalFindings = report.findings.filter(f => f.rule === 'eval-usage')
    expect(evalFindings.length).toBeGreaterThan(0)
  })

  it('aggregates by severity', () => {
    const report = scanSecurity([{
      path: 'src/bad.ts',
      content: [
        'const secret = "super-secret-token-12345678"',
        'eval(input)',
      ].join('\n'),
    }])
    expect(report.bySeverity.high + report.bySeverity.medium + report.bySeverity.low)
      .toBe(report.findings.length)
  })

  it('aggregates by rule', () => {
    const report = scanSecurity([{
      path: 'src/bad.ts',
      content: 'const password = "admin12345678"\n',
    }])
    const totalByRule = Object.values(report.byRule).reduce((a, b) => a + b, 0)
    expect(totalByRule).toBe(report.findings.length)
  })

  it('scans multiple files', () => {
    const report = scanSecurity([
      { path: 'a.ts', content: 'const x = 1\n' },
      { path: 'b.ts', content: 'const y = 2\n' },
    ])
    expect(report.filesScanned).toBe(2)
  })
})
