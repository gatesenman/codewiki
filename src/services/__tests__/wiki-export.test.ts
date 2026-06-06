import { describe, it, expect } from 'vitest'
import { exportMarkdown, exportJSON, exportHTML, exportWiki } from '../wiki-export'
import type { WikiProject } from '../../types'

function makeProject(): WikiProject {
  return {
    id: 'p1',
    name: 'TestProject',
    path: '/tmp/test',
    type: 'local',
    generatedAt: Date.now(),
    status: 'ready',
    wikiPages: [
      { id: 'w1', title: 'Overview', slug: 'overview', content: '# Overview\n\nProject overview.', order: 0, lastUpdated: Date.now() },
      { id: 'w2', title: 'API', slug: 'api', content: '# API\n\nAPI docs.', order: 1, lastUpdated: Date.now() },
    ],
    ontologyGraph: {
      entities: [
        { id: 'e1', name: 'Foo', type: 'Class', filePath: 'src/foo.ts', line: 1, endLine: 10 },
      ],
      relations: [
        { id: 'r1', source: 'e1', target: 'e1', type: 'calls' },
      ],
    },
  }
}

describe('exportMarkdown', () => {
  it('includes table of contents', () => {
    const result = exportMarkdown(makeProject())
    expect(result.content).toContain('Table of Contents')
    expect(result.content).toContain('[Overview]')
    expect(result.content).toContain('[API]')
    expect(result.format).toBe('markdown')
    expect(result.pageCount).toBe(2)
  })

  it('includes metadata header', () => {
    const result = exportMarkdown(makeProject())
    expect(result.content).toContain('TestProject')
    expect(result.content).toContain('2 pages')
  })

  it('skips TOC when option disabled', () => {
    const result = exportMarkdown(makeProject(), { toc: false })
    expect(result.content).not.toContain('Table of Contents')
  })
})

describe('exportJSON', () => {
  it('exports valid JSON', () => {
    const result = exportJSON(makeProject())
    const parsed = JSON.parse(result.content)
    expect(parsed.name).toBe('TestProject')
    expect(parsed.pages).toHaveLength(2)
    expect(result.format).toBe('json')
  })
})

describe('exportHTML', () => {
  it('produces HTML with title', () => {
    const result = exportHTML(makeProject())
    expect(result.content).toContain('<!DOCTYPE html>')
    expect(result.content).toContain('TestProject')
    expect(result.format).toBe('html')
  })
})

describe('exportWiki', () => {
  it('dispatches to correct format', () => {
    expect(exportWiki(makeProject(), 'markdown').format).toBe('markdown')
    expect(exportWiki(makeProject(), 'json').format).toBe('json')
    expect(exportWiki(makeProject(), 'html').format).toBe('html')
  })
})
