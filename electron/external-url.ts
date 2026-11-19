/** URLs the desktop shell may hand to the OS browser. */

export function parseWebUrl(value: string): URL | null {
  try {
    const url = new URL(String(value ?? '').trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0:0:0:0:0:0:0:1'
}

/**
 * Allow the product GitHub repo, other github.com https pages (clone/docs
 * links), and loopback http for a local runtime such as Ollama.
 */
export function isAllowedExternalUrl(value: string): boolean {
  const url = parseWebUrl(value)
  if (!url) return false
  if (url.protocol === 'http:') return isLoopbackHost(url.hostname)
  const host = url.hostname.toLowerCase()
  return host === 'github.com' || host === 'www.github.com' || host === 'docs.github.com'
}
