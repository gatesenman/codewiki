import { describe, expect, it } from 'vitest'
import { buildStructureWikiFromFiles, exportStructureWikiHtml, languageForPath } from '../structure-wiki'

describe('offline structure wiki', () => {
  it('builds a navigable wiki from a local folder listing and exports HTML without an LLM', () => {
    const wiki = buildStructureWikiFromFiles(
      [
        { relativePath: 'README.md', language: languageForPath('README.md'), bytes: 20 },
        { relativePath: 'src/index.ts', language: languageForPath('src/index.ts'), bytes: 12 },
        { relativePath: 'src/util.py', language: languageForPath('src/util.py'), bytes: 8 },
      ],
      { name: 'FixtureRepo', path: '/tmp/fixture', readme: '# Fixture\n\nA tiny repo.' },
    )
    expect(wiki.languages.TypeScript).toBeGreaterThanOrEqual(1)
    expect(wiki.languages.Python).toBeGreaterThanOrEqual(1)
    expect(wiki.project.wikiPages[0].content).toContain('Fixture')
    expect(wiki.project.wikiPages.some((page) => page.title === 'src')).toBe(true)
    const exported = exportStructureWikiHtml(wiki)
    expect(exported.content).toContain('<!DOCTYPE html>')
    expect(exported.content).toContain('FixtureRepo')
    expect(exported.pageCount).toBeGreaterThanOrEqual(2)
  })
})
