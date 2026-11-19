import { exportHTML } from './wiki-export'
import type { WikiPage, WikiProject } from '../types'

export interface StructureFile {
  relativePath: string
  language: string | null
  bytes: number
}

export interface StructureWiki {
  project: WikiProject
  files: StructureFile[]
  languages: Record<string, number>
}

export const LANGS: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.vue': 'Vue',
  '.md': 'Markdown',
  '.json': 'JSON',
}

export function languageForPath(relativePath: string): string | null {
  const dot = relativePath.lastIndexOf('.')
  if (dot < 0) return null
  return LANGS[relativePath.slice(dot).toLowerCase()] ?? null
}

export function buildStructureWikiFromFiles(
  files: StructureFile[],
  options: { name?: string; path?: string; readme?: string } = {},
): StructureWiki {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const languages: Record<string, number> = {}
  for (const file of sorted) {
    if (!file.language) continue
    languages[file.language] = (languages[file.language] ?? 0) + 1
  }
  const folders = new Set(
    sorted
      .map((file) => file.relativePath.split('/').slice(0, -1).join('/'))
      .filter(Boolean),
  )
  const title = options.name || 'structure-wiki'
  const readme = options.readme?.trim() ?? ''
  const pages: WikiPage[] = [
    {
      id: 'overview',
      title: 'Overview',
      slug: 'overview',
      content: `# ${title}\n\nOffline structure wiki (no LLM).\n\nLanguages:\n${Object.entries(languages)
        .map(([lang, count]) => `- ${lang}: ${count}`)
        .join('\n')}\n\n${readme ? `## README\n\n${readme}` : ''}`,
      order: 0,
      lastUpdated: 0,
    },
    ...[...folders].sort().map((folder, index) => ({
      id: `folder-${index}`,
      title: folder,
      slug: `folder-${index}`,
      content: `# ${folder}\n\n${sorted
        .filter((file) => file.relativePath.startsWith(`${folder}/`))
        .map((file) => `- \`${file.relativePath}\`${file.language ? ` (${file.language})` : ''}`)
        .join('\n')}`,
      order: index + 1,
      lastUpdated: 0,
    })),
  ]
  const project: WikiProject = {
    id: 'structure',
    name: title,
    path: options.path || '',
    type: 'local',
    generatedAt: 0,
    status: 'ready',
    wikiPages: pages,
    ontologyGraph: { entities: [], relations: [] },
  }
  return { project, files: sorted, languages }
}

export function exportStructureWikiHtml(wiki: StructureWiki): { content: string; pageCount: number } {
  const html = exportHTML(wiki.project)
  return { content: html.content, pageCount: html.pageCount }
}
