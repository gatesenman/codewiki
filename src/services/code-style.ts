/**
 * Code-rendering styling derived from `ui` settings.
 *
 * Centralises the palettes used by source/code views so the `codeTheme`,
 * `showLineNumbers` and `wordWrap` settings have a single, consistent effect
 * across EntityDetailPanel, WikiViewer, etc.
 */
import type { UIConfig } from './config-manager'

export interface CodeThemeStyle {
  background: string
  color: string
  gutter: string
  border: string
}

const THEMES: Record<UIConfig['codeTheme'], CodeThemeStyle> = {
  'github-dark': { background: '#161b22', color: '#c9d1d9', gutter: '#8b949e', border: '#30363d' },
  'github-light': { background: '#ffffff', color: '#24292f', gutter: '#6e7781', border: '#d0d7de' },
  monokai: { background: '#272822', color: '#f8f8f2', gutter: '#75715e', border: '#3e3d32' },
  'one-dark': { background: '#282c34', color: '#abb2bf', gutter: '#5c6370', border: '#3b4048' },
}

export function getCodeTheme(name: UIConfig['codeTheme']): CodeThemeStyle {
  return THEMES[name] ?? THEMES['github-dark']
}

/** Tailwind whitespace class for the configured wrap behaviour. */
export function wrapClass(wordWrap: boolean): string {
  return wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
}
