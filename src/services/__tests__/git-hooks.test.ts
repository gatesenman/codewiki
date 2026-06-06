import { describe, it, expect } from 'vitest'
import { generateHookScript, generateCIWorkflow, HOOK_MARKER } from '../git-hooks'

describe('generateHookScript', () => {
  it('includes shebang line', () => {
    const script = generateHookScript()
    expect(script).toMatch(/^#!\/bin\/sh/)
  })

  it('includes the marker', () => {
    const script = generateHookScript()
    expect(script).toContain(HOOK_MARKER)
  })

  it('calls codewiki index', () => {
    const script = generateHookScript()
    expect(script).toContain('codewiki index')
  })
})

describe('generateCIWorkflow', () => {
  it('generates valid YAML-like content', () => {
    const workflow = generateCIWorkflow()
    expect(workflow).toContain('name: CodeWiki Sync')
    expect(workflow).toContain('codewiki index')
    expect(workflow).toContain('codewiki wiki-generate')
  })

  it('uses secrets for API key', () => {
    const workflow = generateCIWorkflow()
    expect(workflow).toContain('secrets.OPENAI_API_KEY')
  })
})
