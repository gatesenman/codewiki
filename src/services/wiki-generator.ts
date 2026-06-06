/**
 * Wiki Generator Service
 * 
 * Generates structured wiki documentation from indexed code.
 * Uses LLM for content generation and ontology for structure.
 * 
 * Output format: hierarchical numbered pages (1, 1.1, 2, 2.1, etc.)
 * with source file references, Mermaid diagrams, component tables,
 * and cross-page links — matching industry-standard code wiki tools.
 */

import { v4 as uuid } from 'uuid'
import type { WikiPage, WikiProject, OntologyGraph, FileNode } from '../types'
import { LLMService } from './llm'
import { configManager } from './config-manager'
import { getWikiTemplate, DEFAULT_WIKI_STYLE, type WikiStyleId, type WikiPageKind } from './wiki-prompt-templates'

export class WikiGenerator {
  private llm: LLMService
  private style: WikiStyleId

  constructor(llm: LLMService, style: string = DEFAULT_WIKI_STYLE) {
    this.llm = llm
    this.style = getWikiTemplate(style).id
  }

  setStyle(style: string) {
    this.style = getWikiTemplate(style).id
  }

  /**
   * Generate complete wiki for a project — hierarchical numbered pages
   */
  async generateWiki(
    project: WikiProject,
    files: FileNode[],
    readFile: (path: string) => Promise<string | null>,
    onProgress?: (page: string, current: number, total: number) => void
  ): Promise<WikiPage[]> {
    const pages: WikiPage[] = []
    const flatFiles = this.flattenFiles(files)
    const codeFiles = flatFiles.filter(f => f.type === 'file')
    const graph = project.ontologyGraph

    // Gather project context
    const fileList = codeFiles.map(f => f.relativePath).join('\n')
    const readmeContent = await this.findAndReadFile(codeFiles, readFile, ['README.md', 'readme.md', 'README.rst'])
    const packageJson = await this.findAndReadFile(codeFiles, readFile, ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml'])

    // Analyze project structure for hierarchical wiki plan.
    // `pageCount` caps the total pages: 4 fixed (overview/architecture/api/data-flow)
    // plus a budget of per-module pages.
    const pageCount = configManager.getConfig().wiki.pageCount
    const moduleBudget = Math.max(1, pageCount - 4)
    const modules = this.detectModules(graph, codeFiles, moduleBudget)
    const totalPages = 4 + modules.length  // overview + architecture + modules(n) + api + data flow
    let currentPage = 0

    // ---- Page 1: Overview ----
    onProgress?.('Overview', ++currentPage, totalPages)
    const overviewSources = this.findRelevantFiles(codeFiles, ['README', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'index', 'main', 'app'])
    pages.push(await this.generateStructuredPage(
      'Overview',
      '1-overview',
      0,
      overviewSources,
      `Generate a comprehensive Overview page for this project.

Project name: ${project.name}
File structure:\n${fileList.substring(0, 3000)}

README content:\n${(readmeContent || 'No README found').substring(0, 4000)}

Package info:\n${(packageJson || 'N/A').substring(0, 2000)}

Ontology summary:\n${this.summarizeOntology(graph)}

Requirements:
1. Start with "## Purpose and Scope" explaining what the project does
2. "## What is ${project.name}?" section with version info if available
3. High-level architecture diagram (Mermaid flowchart)
4. Component summary table (Component | File | Purpose)
5. "## Repository Structure" overview of key directories
6. "## Key Technologies" listing main dependencies/tools
7. End each section with a "Sources:" line referencing specific files`,
      'overview',
    ))

    // ---- Page 2: Architecture ----
    onProgress?.('Architecture', ++currentPage, totalPages)
    const archSources = this.findRelevantFiles(codeFiles, ['src/', 'lib/', 'app', 'server', 'index', 'main', 'config'])
    pages.push(await this.generateStructuredPage(
      'Core Architecture',
      '2-core-architecture',
      1,
      archSources,
      `Generate a Core Architecture page.

Code entities found:\n${this.summarizeOntology(graph)}

File structure:\n${fileList.substring(0, 3000)}

Relations summary:
- imports: ${graph.relations.filter(r => r.type === 'imports').length}
- calls: ${graph.relations.filter(r => r.type === 'calls').length}
- extends: ${graph.relations.filter(r => r.type === 'extends').length}
- implements: ${graph.relations.filter(r => r.type === 'implements').length}
- contains: ${graph.relations.filter(r => r.type === 'contains').length}

Requirements:
1. "## Purpose and Scope" explaining architecture documentation coverage
2. System architecture Mermaid diagram showing major components and data flow
3. Component table (Component | Module/File | Key Exports/Methods | Purpose)
4. "## Design Patterns" used in the codebase
5. Module dependency graph (Mermaid)
6. "## Key Architectural Decisions" section
7. Reference specific files with line numbers like [file.ts#L10-L50]
8. End sections with "Sources:" lines`,
      'architecture',
    ))

    // ---- Pages 2.x: Module Detail Pages ----
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i]
      onProgress?.(mod.name, ++currentPage, totalPages)

      const modEntities = mod.entities.slice(0, 30)
      const modRelations = graph.relations.filter(r =>
        mod.entityIds.has(r.source) || mod.entityIds.has(r.target)
      ).slice(0, 50)

      // Read key source files for this module
      const modFileContents: string[] = []
      const modFiles = [...new Set(modEntities.map(e => e.filePath))].slice(0, 5)
      for (const filePath of modFiles) {
        const f = codeFiles.find(cf => cf.relativePath === filePath || cf.path === filePath)
        if (f) {
          const content = await readFile(f.path)
          if (content) modFileContents.push(`### ${f.relativePath}\n\`\`\`\n${content.substring(0, 1500)}\n\`\`\``)
        }
      }

      const modSources = codeFiles.filter(f => modFiles.some(mf => f.relativePath === mf || f.path === mf))

      pages.push(await this.generateStructuredPage(
        mod.name,
        `2.${i + 1}-${mod.name.toLowerCase().replace(/\s+/g, '-')}`,
        2 + i,
        modSources,
        `Generate detailed documentation for the "${mod.name}" module/component.

Entities in this module:
${modEntities.map(e => `- ${e.type} ${e.name} (${e.filePath}:${e.line})${e.signature ? ': ' + e.signature : ''}`).join('\n')}

Relations:
${modRelations.map(r => {
  const src = graph.entities.find(e => e.id === r.source)
  const tgt = graph.entities.find(e => e.id === r.target)
  return src && tgt ? `- ${src.name} --${r.type}--> ${tgt.name}` : null
}).filter(Boolean).join('\n')}

Source code samples:
${modFileContents.join('\n\n').substring(0, 6000)}

Requirements:
1. "## Purpose and Scope" explaining this module's role
2. Component interaction diagram (Mermaid)
3. Key classes/functions table (Name | File:Line | Signature | Purpose)
4. "## Implementation Details" with code examples from the source
5. "## Integration Points" — how this module connects to others
6. Reference specific files with line numbers [file.ts#L10-L50]
7. End sections with "Sources:" referencing actual files`,
        'module',
      ))
    }

    // ---- API Reference page ----
    onProgress?.('API Reference', ++currentPage, totalPages)
    const functions = graph.entities.filter(e => e.type === 'Function' || e.type === 'Method').slice(0, 50)
    const classes = graph.entities.filter(e => e.type === 'Class' || e.type === 'Interface').slice(0, 30)
    const apiSources = codeFiles.filter(f =>
      classes.some(c => c.filePath === f.relativePath) || functions.some(fn => fn.filePath === f.relativePath)
    ).slice(0, 15)

    pages.push(await this.generateStructuredPage(
      'API Reference',
      `${3 + modules.length}-api-reference`,
      2 + modules.length,
      apiSources,
      `Generate an API Reference page.

Classes/Interfaces:
${classes.map(c => `- ${c.type} ${c.name} (${c.filePath}:${c.line})${c.signature ? ': ' + c.signature : ''}`).join('\n')}

Functions/Methods:
${functions.map(f => `- ${f.name} (${f.filePath}:${f.line})${f.signature ? ': ' + f.signature : ''}`).join('\n')}

Requirements:
1. "## Purpose and Scope" explaining API coverage
2. Class hierarchy diagram (Mermaid classDiagram)
3. API summary tables (Name | File:Line | Signature | Description)
4. "## Key Classes" with method listings and descriptions
5. "## Key Functions" with signatures and purpose
6. Code usage examples
7. End sections with "Sources:" referencing actual files`,
      'api',
    ))

    // ---- Data Flow & Patterns page ----
    onProgress?.('Data Flow & Patterns', ++currentPage, totalPages)
    const callRelations = graph.relations.filter(r => r.type === 'calls' || r.type === 'uses')
    const entityMap = new Map(graph.entities.map(e => [e.id, e]))
    const callChains = callRelations.slice(0, 30).map(r => {
      const src = entityMap.get(r.source)
      const tgt = entityMap.get(r.target)
      return src && tgt ? `${src.name} --${r.type}--> ${tgt.name}` : null
    }).filter(Boolean)

    pages.push(await this.generateStructuredPage(
      'Data Flow & Patterns',
      `${4 + modules.length}-data-flow-patterns`,
      3 + modules.length,
      codeFiles.slice(0, 10),
      `Generate a Data Flow & Design Patterns page.

Call chains:\n${callChains.join('\n')}

Import relations: ${graph.relations.filter(r => r.type === 'imports').length} module dependencies
Total entities: ${graph.entities.length}
Total relations: ${graph.relations.length}

Requirements:
1. "## Purpose and Scope" explaining data flow documentation
2. Data flow diagram (Mermaid sequence or flowchart)
3. "## Key Design Patterns" identified with examples
4. "## Request/Response Flow" if applicable
5. "## State Management" patterns
6. "## Error Handling" patterns
7. End sections with "Sources:" referencing files`,
      'dataflow',
    ))

    return pages
  }

  /**
   * Generate a structured page with "Relevant source files" header
   */
  private async generateStructuredPage(
    title: string,
    slug: string,
    order: number,
    relevantFiles: FileNode[],
    prompt: string,
    kind: WikiPageKind = 'default',
  ): Promise<WikiPage> {
    const template = getWikiTemplate(this.style)
    const guidance = template.sectionGuidance[kind] || template.sectionGuidance.default
    const response = await this.llm.chat([
      { role: 'system', content: template.systemPrompt },
      { role: 'user', content: `${prompt}\n\nStyle guidance: ${guidance}` },
    ])

    // Build "Relevant source files" section
    const sourceFileLinks = relevantFiles.slice(0, 15).map(f =>
      `- [${f.relativePath}](${f.relativePath})`
    ).join('\n')

    const content = [
      `# ${title}`,
      '',
      '**Relevant source files**',
      sourceFileLinks || '- (auto-detected)',
      '',
      response.content,
    ].join('\n')

    return {
      id: uuid(),
      title,
      slug,
      content,
      order,
      lastUpdated: Date.now(),
    }
  }

  /**
   * Detect logical modules from ontology graph
   */
  private detectModules(graph: OntologyGraph, files: FileNode[], maxModules = 5): Array<{
    name: string
    entities: typeof graph.entities
    entityIds: Set<string>
  }> {
    // Group entities by directory
    const dirMap = new Map<string, typeof graph.entities>()
    for (const entity of graph.entities) {
      if (entity.type === 'File') continue
      const dir = entity.filePath.split('/').slice(0, -1).join('/') || '.'
      const list = dirMap.get(dir) || []
      list.push(entity)
      dirMap.set(dir, list)
    }

    // Build modules from directory groups that have enough entities
    const modules: Array<{ name: string; entities: typeof graph.entities; entityIds: Set<string> }> = []
    for (const [dir, entities] of dirMap) {
      if (entities.length < 2) continue
      // Generate readable name from directory
      const parts = dir.split('/')
      const name = parts[parts.length - 1] || dir
      const readableName = name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, ' ')
      modules.push({
        name: readableName,
        entities,
        entityIds: new Set(entities.map(e => e.id)),
      })
    }

    // Sort by entity count (most important modules first), limit to the budget.
    modules.sort((a, b) => b.entities.length - a.entities.length)
    return modules.slice(0, maxModules)
  }

  /**
   * Find files matching keyword patterns for "Relevant source files"
   */
  private findRelevantFiles(files: FileNode[], patterns: string[]): FileNode[] {
    return files.filter(f => {
      const lc = f.relativePath.toLowerCase()
      return patterns.some(p => lc.includes(p.toLowerCase()))
    }).slice(0, 15)
  }

  private summarizeOntology(graph: OntologyGraph): string {
    const typeCounts: Record<string, number> = {}
    for (const entity of graph.entities) {
      typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1
    }

    const summary = [
      `Total entities: ${graph.entities.length}`,
      `Total relations: ${graph.relations.length}`,
      '',
      'Entity types:',
      ...Object.entries(typeCounts).map(([type, count]) => `  - ${type}: ${count}`),
      '',
      'Key classes:',
      ...graph.entities
        .filter(e => e.type === 'Class')
        .slice(0, 20)
        .map(e => `  - ${e.name} (${e.filePath}:${e.line})`),
      '',
      'Key functions:',
      ...graph.entities
        .filter(e => e.type === 'Function')
        .slice(0, 20)
        .map(e => `  - ${e.name} (${e.filePath}:${e.line})`),
    ]

    return summary.join('\n')
  }

  private async findAndReadFile(
    files: FileNode[],
    readFile: (path: string) => Promise<string | null>,
    names: string[],
  ): Promise<string | null> {
    for (const name of names) {
      const file = files.find(f =>
        f.name.toLowerCase() === name.toLowerCase() ||
        f.relativePath.toLowerCase().endsWith(name.toLowerCase())
      )
      if (file) {
        const content = await readFile(file.path)
        if (content) return content
      }
    }
    return null
  }

  private flattenFiles(nodes: FileNode[]): FileNode[] {
    const result: FileNode[] = []
    const walk = (items: FileNode[]) => {
      for (const item of items) {
        result.push(item)
        if (item.children) walk(item.children)
      }
    }
    walk(nodes)
    return result
  }
}

// ---- Wiki Quality Validation ----
// Scores a generated wiki page against high-quality code-wiki structural
// conventions (used for in-app quality feedback and CLI comparison checks).

export interface WikiQualityResult {
  percent: number
  score: number
  maxScore: number
  grade: 'A' | 'B' | 'C' | 'D'
  checks: Array<{ id: string; label: string; pass: boolean; weight: number }>
}

const WIKI_QUALITY_CHECKS: Array<{ id: string; label: string; weight: number; test: (md: string) => boolean }> = [
  { id: 'title', label: '页面标题 (H1)', weight: 1, test: (md) => /^#\s+\S+/m.test(md) },
  { id: 'relevant-sources', label: '相关源文件清单', weight: 2, test: (md) => /relevant source files|相关源文件/i.test(md) },
  { id: 'purpose-scope', label: '用途与范围说明', weight: 2, test: (md) => /##\s+(purpose\s+and\s+scope|用途|概述与范围)/i.test(md) },
  { id: 'mermaid', label: 'Mermaid 图表', weight: 2, test: (md) => /```mermaid/.test(md) },
  { id: 'tables', label: '组件/汇总表格', weight: 2, test: (md) => /\|.+\|.+\|/.test(md) },
  { id: 'sources', label: '来源引用 (Sources:)', weight: 3, test: (md) => /sources:|来源[:：]/i.test(md) },
  { id: 'line-citations', label: '行级文件引用 (#Lxx)', weight: 2, test: (md) => /#L\d+(-L?\d+)?/.test(md) },
  { id: 'related-pages', label: '相关页面链接', weight: 1, test: (md) => /##\s+(related\s+pages|相关页面)/i.test(md) || /\]\([^)]*\.md[^)]*\)/.test(md) },
]

export function validateWikiPage(content: string): WikiQualityResult {
  let score = 0
  let maxScore = 0
  const checks = WIKI_QUALITY_CHECKS.map((c) => {
    const pass = c.test(content)
    maxScore += c.weight
    if (pass) score += c.weight
    return { id: c.id, label: c.label, pass, weight: c.weight }
  })
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const grade: WikiQualityResult['grade'] = percent >= 90 ? 'A' : percent >= 75 ? 'B' : percent >= 50 ? 'C' : 'D'
  return { percent, score, maxScore, grade, checks }
}

export function validateWiki(pages: WikiPage[]): { overallPercent: number; pages: Array<{ title: string; quality: WikiQualityResult }> } {
  if (pages.length === 0) return { overallPercent: 0, pages: [] }
  const results = pages.map((p) => ({ title: p.title, quality: validateWikiPage(p.content) }))
  const overallPercent = Math.round(results.reduce((s, r) => s + r.quality.percent, 0) / results.length)
  return { overallPercent, pages: results }
}
