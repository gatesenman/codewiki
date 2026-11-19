import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../external-url'

describe('openExternal allow list', () => {
  it('allows the product repo and loopback http, and rejects unsafe URLs', () => {
    expect(isAllowedExternalUrl('https://github.com/gatesenman/codewiki')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/gatesenman/codewiki/issues/5')).toBe(true)
    expect(isAllowedExternalUrl('http://127.0.0.1:11434')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:11434')).toBe(true)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('http://evil.example/')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pass@github.com/gatesenman/codewiki')).toBe(false)
    expect(isAllowedExternalUrl('https://evil.example/')).toBe(false)
  })
})
