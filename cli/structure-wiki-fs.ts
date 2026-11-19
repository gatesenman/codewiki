import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  buildStructureWikiFromFiles,
  exportStructureWikiHtml,
  languageForPath,
  type StructureFile,
} from '../src/services/structure-wiki'

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'target', 'coverage'])

export function walkFolder(root: string): StructureFile[] {
  const out: StructureFile[] = []
  const visit = (dir: string) => {
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (SKIP.has(name) || name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        visit(full)
        continue
      }
      const rel = relative(root, full).split(sep).join('/')
      out.push({ relativePath: rel, language: languageForPath(rel), bytes: st.size })
    }
  }
  visit(root)
  return out
}

export function readReadme(root: string): string {
  for (const name of ['README.md', 'readme.md', 'README.zh-CN.md']) {
    try {
      return readFileSync(join(root, name), 'utf8').slice(0, 8000)
    } catch {
      /* next */
    }
  }
  return ''
}

export function exportFolderWiki(root: string, outputDir: string, name?: string): { htmlPath: string; pageCount: number } {
  const wiki = buildStructureWikiFromFiles(walkFolder(root), {
    name,
    path: root,
    readme: readReadme(root),
  })
  const exported = exportStructureWikiHtml(wiki)
  mkdirSync(outputDir, { recursive: true })
  const htmlPath = join(outputDir, 'index.html')
  writeFileSync(htmlPath, exported.content, 'utf8')
  return { htmlPath, pageCount: exported.pageCount }
}

