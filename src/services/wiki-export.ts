/**
 * Wiki Export Service
 *
 * Export wiki pages to various formats:
 *   1. **Markdown bundle** — all pages concatenated with frontmatter
 *   2. **JSON** — structured export for programmatic consumption
 *   3. **Single-page HTML** — self-contained HTML with embedded styles
 *
 * Pure functions — wiki pages in → formatted string out.
 */

import type { WikiPage, WikiProject } from '../types'
import { graphStats } from './graph-persistence'

// ── Types ─────────────────────────────────────────────────────────────────

export type ExportFormat = 'markdown' | 'json' | 'html'

export interface ExportOptions {
  /** Include table of contents. Default true. */
  toc?: boolean
  /** Include project metadata header. Default true. */
  metadata?: boolean
  /** Include graph statistics. Default false. */
  graphStats?: boolean
}

export interface ExportResult {
  content: string
  format: ExportFormat
  filename: string
  mimeType: string
  pageCount: number
}

// ── Markdown export ─────────────────────────────────────────────────────

export function exportMarkdown(
  project: WikiProject,
  options: ExportOptions = {},
): ExportResult {
  const { toc = true, metadata = true, graphStats: includeStats = false } = options
  const pages = sortPages(project.wikiPages)
  const parts: string[] = []

  // Header
  if (metadata) {
    parts.push(`# ${project.name} — CodeWiki`)
    parts.push('')
    parts.push(`> Generated at ${new Date(project.generatedAt).toISOString()}`)
    parts.push(`> ${pages.length} pages | ${project.ontologyGraph.entities.length} entities | ${project.ontologyGraph.relations.length} relations`)
    parts.push('')
  }

  // Graph stats
  if (includeStats) {
    const stats = graphStats(project.ontologyGraph)
    parts.push('## Project Statistics')
    parts.push('')
    parts.push(`| Metric | Value |`)
    parts.push(`|--------|-------|`)
    parts.push(`| Files | ${stats.files} |`)
    parts.push(`| Entities | ${stats.entities} |`)
    parts.push(`| Relations | ${stats.relations} |`)
    for (const [type, count] of Object.entries(stats.entityTypes).sort((a, b) => b[1] - a[1])) {
      parts.push(`| ${type} | ${count} |`)
    }
    parts.push('')
  }

  // Table of contents
  if (toc && pages.length > 1) {
    parts.push('## Table of Contents')
    parts.push('')
    for (const [i, page] of pages.entries()) {
      const anchor = page.slug || page.title.toLowerCase().replace(/\s+/g, '-')
      parts.push(`${i + 1}. [${page.title}](#${anchor})`)
    }
    parts.push('')
    parts.push('---')
    parts.push('')
  }

  // Pages
  for (const page of pages) {
    parts.push(page.content)
    parts.push('')
    parts.push('---')
    parts.push('')
  }

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    content: parts.join('\n'),
    format: 'markdown',
    filename: `${safeName}-wiki.md`,
    mimeType: 'text/markdown',
    pageCount: pages.length,
  }
}

// ── JSON export ─────────────────────────────────────────────────────────

export function exportJSON(
  project: WikiProject,
  options: ExportOptions = {},
): ExportResult {
  const { graphStats: includeStats = false } = options
  const exported = {
    name: project.name,
    path: project.path,
    type: project.type,
    generatedAt: project.generatedAt,
    pages: project.wikiPages.map(p => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      content: p.content,
      order: p.order,
      parentId: p.parentId,
      fileSources: p.fileSources,
      lastUpdated: p.lastUpdated,
    })),
    ontology: {
      entityCount: project.ontologyGraph.entities.length,
      relationCount: project.ontologyGraph.relations.length,
      ...(includeStats ? { stats: graphStats(project.ontologyGraph) } : {}),
    },
  }

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    content: JSON.stringify(exported, null, 2),
    format: 'json',
    filename: `${safeName}-wiki.json`,
    mimeType: 'application/json',
    pageCount: project.wikiPages.length,
  }
}

// ── HTML export ─────────────────────────────────────────────────────────

export function exportHTML(
  project: WikiProject,
  options: ExportOptions = {},
): ExportResult {
  const { toc = true, metadata = true } = options
  const pages = sortPages(project.wikiPages)

  const header = metadata
    ? `<header class="header">
        <h1>${escapeHtml(project.name)} — CodeWiki</h1>
        <p class="meta">Generated at ${new Date(project.generatedAt).toISOString()} · ${pages.length} pages</p>
      </header>`
    : ''

  const tocHtml = toc && pages.length > 1
    ? `<nav class="toc">
        <h2>Table of Contents</h2>
        <ol>${pages.map(p => `<li><a href="#${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></li>`).join('')}</ol>
      </nav>`
    : ''

  const pagesHtml = pages.map(p => `
    <article id="${escapeHtml(p.slug)}">
      <h2>${escapeHtml(p.title)}</h2>
      <div class="content">${markdownToBasicHtml(p.content)}</div>
    </article>
  `).join('<hr/>')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(project.name)} — CodeWiki</title>
  <style>
    :root { --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --border: #30363d; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.7; }
    .header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
    .meta { color: var(--muted); font-size: 0.85rem; }
    .toc { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 2rem; }
    .toc ol { padding-left: 1.5rem; }
    .toc a { color: var(--accent); text-decoration: none; }
    article { margin: 2rem 0; }
    h1, h2, h3 { color: var(--text); }
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
    code { background: var(--card); padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em; }
    pre { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; overflow-x: auto; }
    pre code { background: transparent; padding: 0; }
    a { color: var(--accent); }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid var(--border); padding: 0.5rem; text-align: left; }
    th { background: var(--card); }
    blockquote { border-left: 3px solid var(--accent); padding-left: 1rem; color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  ${header}
  ${tocHtml}
  ${pagesHtml}
</body>
</html>`

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    content: html,
    format: 'html',
    filename: `${safeName}-wiki.html`,
    mimeType: 'text/html',
    pageCount: pages.length,
  }
}

// ── Convenience ─────────────────────────────────────────────────────────

export function exportWiki(
  project: WikiProject,
  format: ExportFormat = 'markdown',
  options: ExportOptions = {},
): ExportResult {
  switch (format) {
    case 'markdown': return exportMarkdown(project, options)
    case 'json': return exportJSON(project, options)
    case 'html': return exportHTML(project, options)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sortPages(pages: WikiPage[]): WikiPage[] {
  return [...pages].sort((a, b) => a.order - b.order)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function markdownToBasicHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
}
