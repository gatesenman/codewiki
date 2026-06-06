#!/usr/bin/env node
/**
 * CodeWiki CLI
 *
 * Provides command-line access to CodeWiki's ontology analysis, semantic search,
 * and impact analysis. Designed for Code Agent integration — query before modifying.
 *
 * Usage:
 *   codewiki index <project-path>        Index a project and cache results
 *   codewiki analyze <query>             Full analysis (ontology + search + impact)
 *   codewiki search <query>              Semantic search across codebase
 *   codewiki entity <name>               Get entity info from ontology
 *   codewiki impact <entity-name>        Impact analysis for an entity
 *   codewiki deps <entity-name>          Dependency graph for an entity
 *   codewiki validate <file> [options]   Validate a modification is safe
 *   codewiki test [suite-path]           Run accuracy test suite
 *
 * Flags:
 *   --json          Output machine-readable JSON (for Code Agent)
 *   --project, -p   Project path (default: current directory)
 *   --depth, -d     Traversal depth for impact/deps (default: 3)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'
import { spawnSync } from 'child_process'

// ---- Types ----

interface FileNode {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
}

interface OntologyEntity {
  id: string
  name: string
  type: string
  filePath: string
  line: number
  endLine: number
  signature?: string
}

interface OntologyRelation {
  id: string
  source: string
  target: string
  type: string
  confidence?: number
}

interface OntologyGraph {
  entities: OntologyEntity[]
  relations: OntologyRelation[]
}

interface CacheData {
  graph: OntologyGraph
  indexedAt: number
  projectPath: string
  fileCount: number
}

// ---- Configuration ----

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.pytest_cache', '.mypy_cache',
  'target', 'bin', 'obj', '.idea', '.vscode', '.vs', 'coverage',
  '.turbo', '.cache', 'tmp', 'temp',
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue',
  '.svelte',
])

const SKIP_METHOD_NAMES = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch',
  'finally', 'return', 'throw', 'new', 'delete', 'typeof', 'instanceof',
  'void', 'function', 'class', 'interface', 'constructor', 'super',
  'import', 'export', 'from', 'default', 'const', 'let', 'var',
  'await', 'async', 'yield', 'break', 'continue',
])

function isPythonFile(filePath: string): boolean {
  return filePath.endsWith('.py')
}

function findPythonBlockEnd(lines: string[], startLineIdx: number): number {
  const startLine = lines[startLineIdx]
  const baseIndent = startLine.search(/\S/)
  if (baseIndent < 0) return startLineIdx + 1

  for (let i = startLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.search(/\S/)
    if (indent <= baseIndent) return i // line at same or lower indent = block ended
  }
  return lines.length
}

// ---- File System ----

function readDirectoryRecursive(dirPath: string, basePath: string, depth: number): FileNode[] {
  if (depth > 8) return []
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }) } catch { return [] }
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(basePath, fullPath)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const children = readDirectoryRecursive(fullPath, basePath, depth + 1)
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: fullPath, relativePath, type: 'directory', children })
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (CODE_EXTENSIONS.has(ext)) {
        try {
          const stats = fs.statSync(fullPath)
          if (stats.size < 500_000) {
            nodes.push({ name: entry.name, path: fullPath, relativePath, type: 'file', extension: ext })
          }
        } catch { /* skip */ }
      }
    }
  }
  return nodes
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = []
  for (const n of nodes) { result.push(n); if (n.children) result.push(...flattenFiles(n.children)) }
  return result
}

// ---- Ontology Builder ----

let nextId = 0
function uid() { return `e${++nextId}` }

function buildOntology(projectPath: string): { graph: OntologyGraph; fileContents: Map<string, string> } {
  nextId = 0
  const tree = readDirectoryRecursive(projectPath, projectPath, 0)
  const flat = flattenFiles(tree).filter(f => f.type === 'file')

  const entities: OntologyEntity[] = []
  const relations: OntologyRelation[] = []
  const fileModuleMap = new Map<string, string>()
  const fileContents = new Map<string, string>()
  const classRangesPerFile = new Map<string, Array<{ id: string; name: string; startLine: number; endLine: number }>>()

  for (const file of flat) {
    let content: string
    try { content = fs.readFileSync(file.path, 'utf-8') } catch { continue }
    fileContents.set(file.path, content)
    const lines = content.split('\n')

    const moduleId = uid()
    entities.push({ id: moduleId, name: file.name, type: 'File', filePath: file.relativePath, line: 1, endLine: lines.length })
    fileModuleMap.set(file.path, moduleId)

    const classRanges: Array<{ id: string; name: string; startLine: number; endLine: number }> = []

    // Extract classes
    const isPy = isPythonFile(file.relativePath)
    const classRegex = /(?:@\w+(?:\([^)]*\))?\s*)*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s<>]+))?/g
    const pyClassRegex = /class\s+(\w+)(?:\(([^)]*)\))?:/g
    const classPatterns = isPy ? [pyClassRegex] : [classRegex]
    let m
    for (const pattern of classPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((m = regex.exec(content)) !== null) {
      const line = content.substring(0, m.index).split('\n').length
      const eid = uid()
      const endLine = isPy ? findPythonBlockEnd(lines, line - 1) : findBlockEnd(lines, line - 1)
      entities.push({ id: eid, name: m[1], type: 'Class', filePath: file.relativePath, line, endLine, signature: m[0].replace(/\s+/g, ' ').trim() })
      relations.push({ id: uid(), source: moduleId, target: eid, type: 'contains' })
      classRanges.push({ id: eid, name: m[1], startLine: line, endLine })
      if (m[2]) deferredRelations.push({ sourceId: eid, targetName: m[2].trim(), type: 'extends' })
      if (m[3]) {
        for (const iface of m[3].split(',').map(s => s.replace(/<[^>]+>/g, '').trim())) {
          if (iface) deferredRelations.push({ sourceId: eid, targetName: iface, type: 'implements' })
        }
      }
      }
    }

    classRangesPerFile.set(file.path, classRanges)

    // Extract interfaces
    const ifaceRegex = /(?:export\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+([\w,\s<>]+))?/g
    while ((m = ifaceRegex.exec(content)) !== null) {
      const line = content.substring(0, m.index).split('\n').length
      const eid = uid()
      entities.push({ id: eid, name: m[1], type: 'Interface', filePath: file.relativePath, line, endLine: findBlockEnd(lines, line - 1), signature: m[0].replace(/\s+/g, ' ').trim() })
      relations.push({ id: uid(), source: moduleId, target: eid, type: 'contains' })
    }

    // Extract top-level functions
    const funcPatterns = [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g,
      /def\s+(\w+)\s*\(([^)]*)\)/g,
      /(?:pub\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g,
    ]
    for (const pattern of funcPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((m = regex.exec(content)) !== null) {
        const line = content.substring(0, m.index).split('\n').length
        if (classRanges.some(c => line >= c.startLine && line <= c.endLine)) continue
        const blockEnd = isPy ? findPythonBlockEnd(lines, line - 1) : findBlockEnd(lines, line - 1)
        const eid = uid()
        entities.push({ id: eid, name: m[1], type: 'Function', filePath: file.relativePath, line, endLine: blockEnd, signature: m[0].replace(/\s+/g, ' ').trim() })
        relations.push({ id: uid(), source: moduleId, target: eid, type: 'contains' })
      }
    }

    // Extract arrow functions / React components
    const arrowPatterns = [
      /(?:export\s+)?const\s+(\w+)\s*(?::\s*(?:React\.)?(?:FC|FunctionComponent)(?:<[^>]+>)?)?\s*=\s*(?:async\s+)?\([^)]*\)\s*(?:=>|:)/g,
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/g,
    ]
    const existingNames = new Set(entities.map(e => `${file.relativePath}::${e.name}`))
    for (const pattern of arrowPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((m = regex.exec(content)) !== null) {
        const line = content.substring(0, m.index).split('\n').length
        if (existingNames.has(`${file.relativePath}::${m[1]}`)) continue
        if (classRanges.some(c => line >= c.startLine && line <= c.endLine)) continue
        const eid = uid()
        const isComponent = /^[A-Z]/.test(m[1])
        entities.push({ id: eid, name: m[1], type: isComponent ? 'Component' : 'Function', filePath: file.relativePath, line, endLine: findBlockEnd(lines, line - 1), signature: m[0].replace(/\s+/g, ' ').trim() })
        relations.push({ id: uid(), source: moduleId, target: eid, type: 'contains' })
        existingNames.add(`${file.relativePath}::${m[1]}`)
      }
    }

    // Extract methods inside classes (including abstract methods without body)
    for (const cr of classRanges) {
      const classContent = lines.slice(cr.startLine - 1, cr.endLine).join('\n')
      const methodPatterns = isPy
        ? [/def\s+(\w+)\s*\(([^)]*)\)/g]
        : [
            /(?:(?:public|private|protected|static|readonly|override|abstract|async)\s+)*(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|&,\s]+)?\s*{/g,
            /(?:abstract)\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|&, \t]+)?/g,
          ]
      const seenMethods = new Set<string>()
      for (const pattern of methodPatterns) {
        const regex = new RegExp(pattern.source, pattern.flags)
        while ((m = regex.exec(classContent)) !== null) {
          const mName = m[1]
          if (SKIP_METHOD_NAMES.has(mName)) continue
          if (isPy && mName === '__init__') continue
          if (seenMethods.has(mName)) continue
          seenMethods.add(mName)
          const methodLine = classContent.substring(0, m.index).split('\n').length
          const absoluteLine = cr.startLine + methodLine - 1
          const blockEnd = isPy ? findPythonBlockEnd(lines, absoluteLine - 1) : findBlockEnd(lines, absoluteLine - 1)
          const eid = uid()
          entities.push({ id: eid, name: mName, type: 'Method', filePath: file.relativePath, line: absoluteLine, endLine: blockEnd, signature: m[0].replace(/\s+/g, ' ').trim() })
          relations.push({ id: uid(), source: cr.id, target: eid, type: 'contains' })
        }
      }
    }

    // Extract types/enums
    const typePatterns = [
      /(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/g,
      /(?:export\s+)?enum\s+(\w+)/g,
    ]
    for (const pattern of typePatterns) {
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((m = regex.exec(content)) !== null) {
        const line = content.substring(0, m.index).split('\n').length
        const eid = uid()
        const isEnum = m[0].includes('enum')
        entities.push({ id: eid, name: m[1], type: isEnum ? 'Enum' : 'Type', filePath: file.relativePath, line, endLine: findBlockEnd(lines, line - 1) })
        relations.push({ id: uid(), source: moduleId, target: eid, type: 'contains' })
      }
    }

  }

  // Phase 2: Resolve import relations (after all files are registered)
  function resolveImport(moduleId: string, importPath: string): void {
    const normalizedImport = importPath.replace(/^[./]+/, '').replace(/\\/g, '/')
    for (const [fp, tid] of fileModuleMap) {
      if (tid === moduleId) continue
      const normalizedFile = fp.replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx|py|go|rs)$/, '')
      const fSegments = normalizedFile.split('/')
      const iSegments = normalizedImport.split('/')
      let matches = true
      for (let i = 0; i < iSegments.length; i++) {
        const fi = fSegments.length - iSegments.length + i
        if (fi < 0 || fSegments[fi] !== iSegments[i]) { matches = false; break }
      }
      if (matches) {
        relations.push({ id: uid(), source: moduleId, target: tid, type: 'imports' })
        break
      }
    }
  }

  for (const file of flat) {
    const content = fileContents.get(file.path)
    if (!content) continue
    const moduleId = fileModuleMap.get(file.path)
    if (!moduleId) continue
    const isPy = isPythonFile(file.relativePath)

    // JS/TS imports
    const importRegex = /import\s+(?:type\s+)?(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g
    let m
    while ((m = importRegex.exec(content)) !== null) {
      const importPath = m[3]
      if (!importPath || importPath.startsWith('@') || !importPath.startsWith('.')) continue
      resolveImport(moduleId, importPath)
    }

    // Python imports: from .module import ... / from ..package.module import ...
    if (isPy) {
      const pyImportRegex = /from\s+(\.[\w.]*)\s+import/g
      while ((m = pyImportRegex.exec(content)) !== null) {
        const pyPath = m[1].replace(/\./g, '/')
        resolveImport(moduleId, pyPath)
      }
    }
  }

  // Resolve deferred relations
  for (const d of deferredRelations) {
    const target = entities.find(e => e.name === d.targetName)
    if (target) relations.push({ id: uid(), source: d.sourceId, target: target.id, type: d.type })
  }
  deferredRelations.length = 0

  // Build call relations (O(1) index)
  const funcIndex = new Map<string, OntologyEntity[]>()
  for (const e of entities) {
    if (e.type === 'Function' || e.type === 'Method' || e.type === 'Component') {
      const list = funcIndex.get(e.name) || []
      list.push(e)
      funcIndex.set(e.name, list)
    }
  }

  for (const file of flat) {
    const content = fileContents.get(file.path)
    if (!content) continue
    const fileEnts = entities.filter(e => e.filePath === file.relativePath && e.type !== 'File')
    for (const entity of fileEnts) {
      const entContent = content.split('\n').slice(entity.line - 1, entity.endLine).join('\n')
      for (const [funcName, targets] of funcIndex) {
        if (funcName === entity.name || funcName.length < 2) continue
        if (!entContent.includes(funcName)) continue
        if (new RegExp(`\\b${funcName}\\s*\\(`).test(entContent)) {
          const sameFile = targets.find(t => t.filePath === file.relativePath && t.id !== entity.id)
          const target = sameFile || targets.find(t => t.id !== entity.id)
          if (target && !relations.some(r => r.source === entity.id && r.target === target.id && r.type === 'calls')) {
            relations.push({ id: uid(), source: entity.id, target: target.id, type: 'calls' })
          }
        }
      }
    }
  }

  return { graph: { entities, relations }, fileContents }
}

const deferredRelations: Array<{ sourceId: string; targetName: string; type: string }> = []

function findBlockEnd(lines: string[], startLine: number): number {
  let braceCount = 0
  let found = false
  let inStr = false
  let strChar = ''
  let inBlockComment = false

  for (let i = startLine; i < lines.length && i < startLine + 500; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      const next = j + 1 < line.length ? line[j + 1] : ''
      const prev = j > 0 ? line[j - 1] : ''

      if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; j++ }; continue }
      if (ch === '/' && next === '/') break
      if (ch === '/' && next === '*') { inBlockComment = true; j++; continue }
      if (inStr) { if (ch === strChar && prev !== '\\') inStr = false; continue }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = true; strChar = ch; continue }
      if (ch === '{') { braceCount++; found = true }
      if (ch === '}') braceCount--
      if (found && braceCount === 0) return i + 1
    }
    if (!found && i > startLine && lines[i].trim() !== '' && !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) return i
  }
  return Math.min(startLine + 50, lines.length)
}

// ---- TF-IDF Search ----

interface Doc { id: string; content: string; filePath: string }

function buildSearchDocs(fileContents: Map<string, string>, projectPath: string): Doc[] {
  return Array.from(fileContents.entries()).map(([p, c]) => ({
    id: p, content: c.substring(0, 8000), filePath: path.relative(projectPath, p),
  }))
}

function tfidfSearch(docs: Doc[], query: string, topK: number): Array<{ filePath: string; content: string; score: number }> {
  const tokenize = (s: string) => s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(t => t.length > 1)
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const N = docs.length
  const df = new Map<string, number>()
  const docTokenSets = docs.map(d => {
    const set = new Set(tokenize(d.content))
    for (const t of set) df.set(t, (df.get(t) || 0) + 1)
    return set
  })

  const scores = docs.map((d, i) => {
    let score = 0
    for (const qt of queryTokens) {
      if (docTokenSets[i].has(qt)) score += Math.log(1 + N / (df.get(qt) || 1))
    }
    return { filePath: d.filePath, content: d.content.substring(0, 300), score }
  })

  return scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topK)
}

// ---- Impact Analysis ----

function getImpactedEntities(entityId: string, graph: OntologyGraph, depth: number): Set<string> {
  const impacted = new Set<string>()
  const queue = [{ id: entityId, d: 0 }]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.d > depth || impacted.has(cur.id)) continue
    impacted.add(cur.id)
    for (const r of graph.relations) {
      if (r.type === 'contains' && r.target === cur.id) continue
      const nextId = r.source === cur.id ? r.target : (r.target === cur.id ? r.source : null)
      if (nextId && !impacted.has(nextId)) queue.push({ id: nextId, d: cur.d + 1 })
    }
  }
  return impacted
}

// ---- Cache ----

function getCachePath(projectPath: string): string {
  return path.join(projectPath, '.codewiki', 'cache.json')
}

function saveCache(projectPath: string, graph: OntologyGraph, fileCount: number): void {
  const cachePath = getCachePath(projectPath)
  const cacheDir = path.dirname(cachePath)
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const data: CacheData = { graph, indexedAt: Date.now(), projectPath, fileCount }
  fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8')
}

function loadCache(projectPath: string): CacheData | null {
  const cachePath = getCachePath(projectPath)
  if (!fs.existsSync(cachePath)) return null
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
  } catch { return null }
}

// ---- Output Helpers ----

const isJson = process.argv.includes('--json')

// Last structured result produced by a command — captured for call-log scoring.
let __lastOutput: unknown = null

function output(data: unknown): void {
  __lastOutput = data
  if (isJson) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    printHuman(data)
  }
}

function printHuman(data: unknown): void {
  if (typeof data === 'string') { console.log(data); return }
  const obj = data as Record<string, unknown>

  if (obj.command === 'index') {
    const r = obj as { entities: number; relations: number; files: number; cached: string }
    console.log(`\n  CodeWiki Index Complete`)
    console.log(`  ─────────────────────`)
    console.log(`  Files:     ${r.files}`)
    console.log(`  Entities:  ${r.entities}`)
    console.log(`  Relations: ${r.relations}`)
    console.log(`  Cache:     ${r.cached}\n`)
    return
  }

  if (obj.command === 'analyze') {
    const r = obj as { query: string; entities: unknown[]; searchResults: unknown[]; impactedEntities: unknown[]; impactedFiles: string[] }
    console.log(`\n  Analysis: "${r.query}"`)
    console.log(`  ─────────────────────`)
    console.log(`\n  Matching Entities (${(r.entities as []).length}):`)
    for (const e of r.entities as OntologyEntity[]) {
      console.log(`    ${e.type.padEnd(12)} ${e.name.padEnd(30)} ${e.filePath}:${e.line}`)
    }
    console.log(`\n  Search Results (${(r.searchResults as []).length}):`)
    for (const s of r.searchResults as Array<{ filePath: string; score: number }>) {
      console.log(`    [${s.score.toFixed(2)}] ${s.filePath}`)
    }
    console.log(`\n  Impact Scope:`)
    console.log(`    Entities: ${(r.impactedEntities as []).length}`)
    console.log(`    Files:    ${r.impactedFiles.join(', ')}\n`)
    return
  }

  console.log(JSON.stringify(data, null, 2))
}

// ---- Commands ----

function cmdIndex(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  if (!fs.existsSync(absPath)) { console.error(`Error: ${absPath} does not exist`); process.exit(1) }

  const { graph } = buildOntology(absPath)
  const flat = flattenFiles(readDirectoryRecursive(absPath, absPath, 0)).filter(f => f.type === 'file')
  saveCache(absPath, graph, flat.length)

  output({
    command: 'index',
    entities: graph.entities.length,
    relations: graph.relations.length,
    files: flat.length,
    cached: getCachePath(absPath),
  })
}

function addConfidenceScores(graph: OntologyGraph): void {
  for (const r of graph.relations) {
    if (r.confidence !== undefined) continue
    switch (r.type) {
      case 'contains': r.confidence = 1.0; break
      case 'extends': case 'implements': r.confidence = 0.95; break
      case 'imports': r.confidence = 0.9; break
      case 'calls': r.confidence = 0.7; break
      case 'uses': r.confidence = 0.6; break
      default: r.confidence = 0.5; break
    }
  }
}

function getGraph(projectPath: string): { graph: OntologyGraph; fileContents: Map<string, string> } {
  const absPath = path.resolve(projectPath)
  const cached = loadCache(absPath)
  let result: { graph: OntologyGraph; fileContents: Map<string, string> }
  if (cached) {
    const tree = readDirectoryRecursive(absPath, absPath, 0)
    const flat = flattenFiles(tree).filter(f => f.type === 'file')
    const fileContents = new Map<string, string>()
    for (const f of flat) { try { fileContents.set(f.path, fs.readFileSync(f.path, 'utf-8')) } catch { /* skip */ } }
    result = { graph: cached.graph, fileContents }
  } else {
    result = buildOntology(absPath)
  }
  // Add confidence scores to all relations
  addConfidenceScores(result.graph)
  // Enrich with LSIF/SCIP data if available
  const lsif = parseLsifIndex(absPath)
  if (lsif) enrichGraphWithLsif(result.graph, lsif, absPath)
  return result
}

function cmdAnalyze(query: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const docs = buildSearchDocs(fileContents, absPath)

  // Find matching entities
  const queryTerms = query.toLowerCase().split(/\s+/)
  const matchingEntities = graph.entities
    .map(e => {
      let score = 0
      const name = e.name.toLowerCase()
      for (const term of queryTerms) {
        if (name === term) score += 5
        if (name.includes(term)) score += 3
        if ((e.signature || '').toLowerCase().includes(term)) score += 1
      }
      return { ...e, score }
    })
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  // Semantic search
  const searchResults = tfidfSearch(docs, query, 10)

  // Impact analysis for top matching entity
  let impactedEntities: OntologyEntity[] = []
  let impactedFiles: string[] = []
  if (matchingEntities.length > 0) {
    const impacted = getImpactedEntities(matchingEntities[0].id, graph, depth)
    impactedEntities = graph.entities.filter(e => impacted.has(e.id))
    impactedFiles = [...new Set(impactedEntities.map(e => e.filePath))]
  }

  output({
    command: 'analyze',
    query,
    entities: matchingEntities.map(({ score: _s, ...e }) => e),
    searchResults,
    impactedEntities: impactedEntities.map(e => ({ name: e.name, type: e.type, filePath: e.filePath, line: e.line })),
    impactedFiles,
  })
}

function cmdSearch(query: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { fileContents } = getGraph(absPath)
  const docs = buildSearchDocs(fileContents, absPath)
  const results = tfidfSearch(docs, query, 10)
  output({ command: 'search', query, results })
}

function cmdEntity(name: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const matches = graph.entities.filter(e => e.name.toLowerCase().includes(name.toLowerCase()))

  const enriched = matches.map(e => {
    const rels = graph.relations.filter(r => r.source === e.id || r.target === e.id)
    return {
      ...e,
      relations: rels.map(r => {
        const other = graph.entities.find(o => o.id === (r.source === e.id ? r.target : r.source))
        return { direction: r.source === e.id ? 'outgoing' : 'incoming', type: r.type, target: other?.name, targetType: other?.type }
      }),
    }
  })

  output({ command: 'entity', name, matches: enriched })
}

function cmdImpact(entityName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const entity = graph.entities.find(e => e.name.toLowerCase() === entityName.toLowerCase())
  if (!entity) { output({ command: 'impact', error: `Entity "${entityName}" not found` }); return }

  const impacted = getImpactedEntities(entity.id, graph, depth)
  const impactedEntities = graph.entities.filter(e => impacted.has(e.id) && e.id !== entity.id)
  const byFile = new Map<string, typeof impactedEntities>()
  for (const e of impactedEntities) { const l = byFile.get(e.filePath) || []; l.push(e); byFile.set(e.filePath, l) }

  output({
    command: 'impact',
    entity: { name: entity.name, type: entity.type, filePath: entity.filePath, line: entity.line },
    impactedCount: impactedEntities.length,
    impactedFiles: byFile.size,
    details: Array.from(byFile.entries()).map(([file, ents]) => ({
      file,
      entities: ents.map(e => ({ name: e.name, type: e.type, line: e.line })),
    })),
  })
}

function cmdDeps(entityName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const entity = graph.entities.find(e => e.name.toLowerCase() === entityName.toLowerCase())
  if (!entity) { output({ command: 'deps', error: `Entity "${entityName}" not found` }); return }

  const deps: Array<{ direction: string; type: string; entity: string; entityType: string; file: string }> = []
  const visited = new Set<string>()
  function traverse(id: string, d: number) {
    if (d > depth || visited.has(id)) return
    visited.add(id)
    for (const r of graph.relations) {
      if (r.source === id) {
        const t = graph.entities.find(e => e.id === r.target)
        if (t) { deps.push({ direction: 'outgoing', type: r.type, entity: t.name, entityType: t.type, file: t.filePath }); traverse(r.target, d + 1) }
      }
      if (r.target === id) {
        const s = graph.entities.find(e => e.id === r.source)
        if (s) { deps.push({ direction: 'incoming', type: r.type, entity: s.name, entityType: s.type, file: s.filePath }) }
      }
    }
  }
  traverse(entity.id, 0)

  output({
    command: 'deps',
    entity: { name: entity.name, type: entity.type, filePath: entity.filePath },
    dependencies: deps,
  })
}

function cmdValidate(filePath: string, startLine: number, endLine: number, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const absFile = path.resolve(filePath)
  const { graph } = getGraph(absPath)

  // Check file exists
  if (!fs.existsSync(absFile)) { output({ command: 'validate', safe: false, error: `File not found: ${absFile}` }); return }

  const content = fs.readFileSync(absFile, 'utf-8')
  const lines = content.split('\n')
  const relPath = path.relative(absPath, absFile)

  // Find entities in the modification range
  const affectedEntities = graph.entities.filter(e =>
    e.filePath === relPath && e.line <= endLine && e.endLine >= startLine
  )

  // Get impact for all affected entities
  const allImpacted = new Set<string>()
  for (const e of affectedEntities) {
    const imp = getImpactedEntities(e.id, graph, 2)
    for (const id of imp) allImpacted.add(id)
  }
  const impactedEntities = graph.entities.filter(e => allImpacted.has(e.id))
  const impactedFiles = [...new Set(impactedEntities.map(e => e.filePath))]

  output({
    command: 'validate',
    safe: true,
    file: relPath,
    range: { startLine, endLine },
    currentContent: lines.slice(startLine - 1, endLine).join('\n'),
    affectedEntities: affectedEntities.map(e => ({ name: e.name, type: e.type, line: e.line })),
    impactScope: {
      entities: impactedEntities.length,
      files: impactedFiles,
    },
    warnings: impactedFiles.length > 5 ? ['High impact: modification affects many files'] : [],
  })
}

// ---- Pre-check: comprehensive analysis before code modification ----

function cmdPreCheck(entityOrFile: string, description: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const docs = buildSearchDocs(fileContents, absPath)

  // Try to find as entity first
  const entity = graph.entities.find(e => e.name.toLowerCase() === entityOrFile.toLowerCase())

  // Also try as file
  const relFile = entityOrFile.replace(/\\/g, '/')
  const fileEntity = graph.entities.find(e => e.type === 'File' && e.filePath.replace(/\\/g, '/').includes(relFile))

  const targetEntity = entity || fileEntity
  if (!targetEntity) {
    output({ command: 'pre-check', error: `Entity or file "${entityOrFile}" not found`, suggestion: 'Use "codewiki entity <name>" to list matching entities' })
    return
  }

  // 1. Get full entity info with relations
  const rels = graph.relations.filter(r => r.source === targetEntity.id || r.target === targetEntity.id)
  const relDetails = rels.map(r => {
    const other = graph.entities.find(e => e.id === (r.source === targetEntity.id ? r.target : r.source))
    return { direction: r.source === targetEntity.id ? 'outgoing' : 'incoming', type: r.type, entity: other?.name, entityType: other?.type, file: other?.filePath }
  })

  // 2. Impact analysis
  const impacted = getImpactedEntities(targetEntity.id, graph, depth)
  const impactedEntities = graph.entities.filter(e => impacted.has(e.id) && e.id !== targetEntity.id)
  const impactedByFile = new Map<string, typeof impactedEntities>()
  for (const e of impactedEntities) { const l = impactedByFile.get(e.filePath) || []; l.push(e); impactedByFile.set(e.filePath, l) }

  // 3. Semantic search for description context
  const searchResults = description ? tfidfSearch(docs, description, 5) : []

  // 4. Read current source code of target
  let sourceCode = ''
  if (targetEntity.type !== 'File') {
    const fullPath = path.join(absPath, targetEntity.filePath)
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      sourceCode = lines.slice(targetEntity.line - 1, targetEntity.endLine).join('\n')
    }
  }

  // 5. Find sibling entities (same file, same parent)
  const siblings = graph.entities.filter(e =>
    e.filePath === targetEntity.filePath && e.id !== targetEntity.id && e.type !== 'File'
  )

  // 6. Warnings
  const warnings: string[] = []
  if (impactedEntities.length > 20) warnings.push(`Very high impact: ${impactedEntities.length} entities affected`)
  if (impactedByFile.size > 8) warnings.push(`Wide impact: ${impactedByFile.size} files affected`)

  const callers = rels.filter(r => r.type === 'calls' && graph.entities.find(e => e.id === r.source)?.id !== targetEntity.id)
  if (callers.length > 5) warnings.push(`Many callers (${callers.length}): check all call sites after modification`)

  const implementors = rels.filter(r => r.type === 'implements' || r.type === 'extends')
  if (implementors.length > 0) warnings.push(`Has inheritance chain: ensure interface/base class compatibility`)

  output({
    command: 'pre-check',
    target: {
      name: targetEntity.name,
      type: targetEntity.type,
      filePath: targetEntity.filePath,
      line: targetEntity.line,
      endLine: targetEntity.endLine,
      signature: targetEntity.signature,
    },
    modification: description || '(not specified)',
    currentSource: sourceCode.substring(0, 5000),
    relations: relDetails,
    siblings: siblings.map(e => ({ name: e.name, type: e.type, line: e.line })),
    impactAnalysis: {
      totalEntities: impactedEntities.length,
      totalFiles: impactedByFile.size,
      byFile: Array.from(impactedByFile.entries()).map(([file, ents]) => ({
        file,
        entities: ents.map(e => ({ name: e.name, type: e.type, line: e.line })),
      })),
    },
    relatedCode: searchResults,
    warnings,
    recommendation: warnings.length === 0 ? 'Low risk: proceed with modification'
      : warnings.length <= 2 ? 'Medium risk: review impact scope before modifying'
      : 'High risk: consider breaking modification into smaller changes',
  })
}

// ---- Verify: post-modification check ----

function cmdVerify(filePath: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const absFile = path.resolve(absPath, filePath)

  if (!fs.existsSync(absFile)) { output({ command: 'verify', error: `File not found: ${absFile}` }); return }

  // Re-index the single file to check for syntax issues
  const content = fs.readFileSync(absFile, 'utf-8')
  const lines = content.split('\n')

  // Check basic syntax markers
  const issues: string[] = []

  // Check balanced braces
  let braceCount = 0
  let parenCount = 0
  let bracketCount = 0
  let inStr = false
  let strCh = ''
  let inBlockComment = false

  for (const line of lines) {
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      const next = j + 1 < line.length ? line[j + 1] : ''
      const prev = j > 0 ? line[j - 1] : ''
      if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; j++ }; continue }
      if (ch === '/' && next === '/') break
      if (ch === '/' && next === '*') { inBlockComment = true; j++; continue }
      if (inStr) { if (ch === strCh && prev !== '\\') inStr = false; continue }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = true; strCh = ch; continue }
      if (ch === '{') braceCount++
      if (ch === '}') braceCount--
      if (ch === '(') parenCount++
      if (ch === ')') parenCount--
      if (ch === '[') bracketCount++
      if (ch === ']') bracketCount--
    }
  }

  if (braceCount !== 0) issues.push(`Unbalanced braces: ${braceCount > 0 ? `${braceCount} unclosed '{'` : `${-braceCount} extra '}'`}`)
  if (parenCount !== 0) issues.push(`Unbalanced parentheses: ${parenCount > 0 ? `${parenCount} unclosed '('` : `${-parenCount} extra ')'`}`)
  if (bracketCount !== 0) issues.push(`Unbalanced brackets: ${bracketCount > 0 ? `${bracketCount} unclosed '['` : `${-bracketCount} extra ']'`}`)

  // Re-build ontology for the file and compare with cached version
  const { graph: freshGraph } = buildOntology(absPath)
  const { graph: cachedGraph } = getGraph(absPath)

  const relPath = path.relative(absPath, absFile).replace(/\\/g, '/')
  const freshEntities = freshGraph.entities.filter(e => e.filePath.replace(/\\/g, '/') === relPath)
  const cachedEntities = cachedGraph.entities.filter(e => e.filePath.replace(/\\/g, '/') === relPath)

  // Find removed entities
  const freshNames = new Set(freshEntities.map(e => `${e.type}:${e.name}`))
  const cachedNames = new Set(cachedEntities.map(e => `${e.type}:${e.name}`))
  const removed = [...cachedNames].filter(n => !freshNames.has(n))
  const added = [...freshNames].filter(n => !cachedNames.has(n))

  if (removed.length > 0) issues.push(`Entities removed: ${removed.join(', ')} — check if this is intentional`)

  // Check if removed entities had dependents
  for (const entityKey of removed) {
    const [, eName] = entityKey.split(':')
    const cachedEntity = cachedGraph.entities.find(e => e.name === eName && e.filePath.replace(/\\/g, '/') === relPath)
    if (cachedEntity) {
      const dependents = cachedGraph.relations
        .filter(r => r.target === cachedEntity.id && r.type !== 'contains')
        .map(r => cachedGraph.entities.find(e => e.id === r.source)?.name)
        .filter(Boolean)
      if (dependents.length > 0) {
        issues.push(`WARNING: Removed ${eName} has dependents: ${dependents.join(', ')}`)
      }
    }
  }

  output({
    command: 'verify',
    file: filePath,
    syntaxCheck: {
      balanced: braceCount === 0 && parenCount === 0 && bracketCount === 0,
      details: braceCount === 0 && parenCount === 0 && bracketCount === 0 ? 'All delimiters balanced' : issues.filter(i => i.startsWith('Unbalanced')).join('; '),
    },
    entityChanges: {
      added: added.length > 0 ? added : [],
      removed: removed.length > 0 ? removed : [],
      total: { before: cachedEntities.length, after: freshEntities.length },
    },
    issues,
    passed: issues.filter(i => i.startsWith('WARNING')).length === 0 && braceCount === 0 && parenCount === 0 && bracketCount === 0,
  })

  // Update cache with fresh data
  const flat = flattenFiles(readDirectoryRecursive(absPath, absPath, 0)).filter(f => f.type === 'file')
  saveCache(absPath, freshGraph, flat.length)
}

// ---- Apply: Code Agent direct modification ----

function cmdApply(filePath: string, startLine: number, endLine: number, newContent: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const absFile = path.resolve(absPath, filePath)

  if (!fs.existsSync(absFile)) { output({ command: 'apply', error: `File not found: ${absFile}` }); return }

  const content = fs.readFileSync(absFile, 'utf-8')
  const lines = content.split('\n')

  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    output({ command: 'apply', error: `Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)` })
    return
  }

  const originalContent = lines.slice(startLine - 1, endLine).join('\n')

  // Create backup
  const backupDir = path.join(absPath, '.codewiki', 'backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
  const backupName = path.relative(absPath, absFile).replace(/[\\/]/g, '__') + `.${Date.now()}.bak`
  const backupPath = path.join(backupDir, backupName)
  fs.writeFileSync(backupPath, content, 'utf-8')

  // Apply modification
  const newLines = newContent.split('\n')
  lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)
  fs.writeFileSync(absFile, lines.join('\n'), 'utf-8')

  output({
    command: 'apply',
    file: filePath,
    range: { start: startLine, end: endLine },
    linesReplaced: endLine - startLine + 1,
    linesInserted: newLines.length,
    backupPath,
    originalContent: originalContent.substring(0, 300),
    success: true,
  })
}

function cmdApplyJson(planPath: string, projectPath: string): void {
  if (!fs.existsSync(planPath)) { output({ command: 'apply-batch', error: `Plan file not found: ${planPath}` }); return }

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'))
  const modifications = plan.modifications || plan

  if (!Array.isArray(modifications)) { output({ command: 'apply-batch', error: 'Plan must contain an array of modifications' }); return }

  const results: unknown[] = []
  // Sort by file, then by startLine descending (apply from bottom to top to preserve line numbers)
  const sorted = [...modifications].sort((a: { file: string; startLine: number }, b: { file: string; startLine: number }) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return b.startLine - a.startLine
  })

  for (const mod of sorted) {
    const { file, startLine, endLine, newContent } = mod as { file: string; startLine: number; endLine: number; newContent: string }
    try {
      cmdApply(file, startLine, endLine, newContent, projectPath)
      results.push({ file, startLine, endLine, success: true })
    } catch (err) {
      results.push({ file, startLine, endLine, success: false, error: String(err) })
    }
  }

  output({ command: 'apply-batch', total: modifications.length, results })
}

// ---- Rollback: restore from backup ----

function cmdRollback(filePath: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const absFile = path.resolve(absPath, filePath)
  const backupDir = path.join(absPath, '.codewiki', 'backups')

  if (!fs.existsSync(backupDir)) { output({ command: 'rollback', error: 'No backups found' }); return }

  const prefix = path.relative(absPath, absFile).replace(/[\\/]/g, '__')
  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(prefix))
    .sort()
    .reverse()

  if (backups.length === 0) { output({ command: 'rollback', error: `No backup found for ${filePath}` }); return }

  const latestBackup = path.join(backupDir, backups[0])
  const backupContent = fs.readFileSync(latestBackup, 'utf-8')
  fs.writeFileSync(absFile, backupContent, 'utf-8')

  // Remove the used backup
  fs.unlinkSync(latestBackup)

  output({
    command: 'rollback',
    file: filePath,
    restoredFrom: backups[0],
    remainingBackups: backups.length - 1,
    success: true,
  })
}

// ---- Diff: show changes vs backup ----

function cmdDiff(filePath: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const absFile = path.resolve(absPath, filePath)
  const backupDir = path.join(absPath, '.codewiki', 'backups')

  if (!fs.existsSync(absFile)) { output({ command: 'diff', error: `File not found: ${absFile}` }); return }

  const currentContent = fs.readFileSync(absFile, 'utf-8')

  if (!fs.existsSync(backupDir)) { output({ command: 'diff', file: filePath, changes: [], message: 'No backups to compare against' }); return }

  const prefix = path.relative(absPath, absFile).replace(/[\\/]/g, '__')
  const backups = fs.readdirSync(backupDir).filter(f => f.startsWith(prefix)).sort().reverse()

  if (backups.length === 0) { output({ command: 'diff', file: filePath, changes: [], message: 'No backup found for this file' }); return }

  const backupContent = fs.readFileSync(path.join(backupDir, backups[0]), 'utf-8')
  const currentLines = currentContent.split('\n')
  const backupLines = backupContent.split('\n')

  const changes: { line: number; type: 'added' | 'removed' | 'changed'; old?: string; new?: string }[] = []
  const maxLen = Math.max(currentLines.length, backupLines.length)

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < backupLines.length ? backupLines[i] : undefined
    const newLine = i < currentLines.length ? currentLines[i] : undefined
    if (oldLine !== newLine) {
      if (oldLine === undefined) changes.push({ line: i + 1, type: 'added', new: newLine })
      else if (newLine === undefined) changes.push({ line: i + 1, type: 'removed', old: oldLine })
      else changes.push({ line: i + 1, type: 'changed', old: oldLine, new: newLine })
    }
  }

  output({
    command: 'diff',
    file: filePath,
    backup: backups[0],
    totalChanges: changes.length,
    changes: changes.slice(0, 50),
    truncated: changes.length > 50,
    summary: {
      added: changes.filter(c => c.type === 'added').length,
      removed: changes.filter(c => c.type === 'removed').length,
      changed: changes.filter(c => c.type === 'changed').length,
    },
  })
}

// ---- Status: project indexing status ----

function cmdStatus(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const cache = loadCache(absPath)

  if (!cache) {
    output({ command: 'status', indexed: false, message: `No index found for ${absPath}. Run 'codewiki index ${projectPath}' first.` })
    return
  }

  const entityTypes: Record<string, number> = {}
  for (const e of cache.graph.entities) {
    entityTypes[e.type] = (entityTypes[e.type] || 0) + 1
  }

  const relationTypes: Record<string, number> = {}
  for (const r of cache.graph.relations) {
    relationTypes[r.type] = (relationTypes[r.type] || 0) + 1
  }

  const files = new Set(cache.graph.entities.map(e => e.filePath))

  output({
    command: 'status',
    indexed: true,
    projectPath: cache.projectPath,
    indexedAt: new Date(cache.indexedAt).toISOString(),
    age: `${Math.round((Date.now() - cache.indexedAt) / 1000 / 60)} minutes ago`,
    stats: {
      totalEntities: cache.graph.entities.length,
      totalRelations: cache.graph.relations.length,
      totalFiles: files.size,
      entityTypes,
      relationTypes,
    },
  })
}

// ---- Config: manage .codewikirc ----

interface CLIConfig {
  indexing?: { maxDepth?: number; maxFileSize?: number; extensions?: string[]; ignoreDirs?: string[] }
  llm?: { provider?: string; model?: string; apiBaseUrl?: string }
  ontology?: { impactDepth?: number }
  search?: { maxResults?: number; minScore?: number }
}

function getConfigPath(projectPath: string): string {
  return path.join(path.resolve(projectPath), '.codewikirc')
}

function loadCLIConfig(projectPath: string): CLIConfig {
  const configPath = getConfigPath(projectPath)
  if (!fs.existsSync(configPath)) return {}
  try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch { return {} }
}

function cmdConfig(action: string, key: string | undefined, value: string | undefined, projectPath: string): void {
  const configPath = getConfigPath(projectPath)

  if (action === 'init') {
    if (fs.existsSync(configPath)) {
      output({ command: 'config', action: 'init', error: `.codewikirc already exists at ${configPath}` })
      return
    }
    const defaultConfig: CLIConfig = {
      indexing: { maxDepth: 8, maxFileSize: 500000, extensions: ['.ts', '.tsx', '.js', '.jsx', '.py'], ignoreDirs: ['node_modules', '.git', 'dist', 'build'] },
      llm: { provider: 'openai', model: 'gpt-4o' },
      ontology: { impactDepth: 3 },
      search: { maxResults: 10, minScore: 0.01 },
    }
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
    output({ command: 'config', action: 'init', path: configPath, success: true })
    return
  }

  if (action === 'get') {
    const config = loadCLIConfig(projectPath)
    if (!key) { output({ command: 'config', action: 'get', config }); return }
    const parts = key.split('.')
    let cur: unknown = config
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = (cur as Record<string, unknown>)[p]
      else { cur = undefined; break }
    }
    output({ command: 'config', action: 'get', key, value: cur })
    return
  }

  if (action === 'set') {
    if (!key || value === undefined) { output({ command: 'config', error: 'Usage: codewiki config set <key> <value>' }); return }
    const config = loadCLIConfig(projectPath)
    const parts = key.split('.')
    let cur: Record<string, unknown> = config as Record<string, unknown>
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
      cur = cur[parts[i]] as Record<string, unknown>
    }
    // Try to parse value as JSON (for arrays/numbers/booleans)
    try { cur[parts[parts.length - 1]] = JSON.parse(value) } catch { cur[parts[parts.length - 1]] = value }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    output({ command: 'config', action: 'set', key, value: cur[parts[parts.length - 1]], success: true })
    return
  }

  output({ command: 'config', error: `Unknown config action: ${action}. Use: init, get, set` })
}

// ---- Relations: query entity relations ----

function cmdRelations(entityName: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)

  const entity = graph.entities.find(e =>
    e.name.toLowerCase() === entityName.toLowerCase() ||
    e.id.toLowerCase().includes(entityName.toLowerCase()),
  )

  if (!entity) { output({ command: 'relations', error: `Entity not found: ${entityName}` }); return }

  const outgoing = graph.relations
    .filter(r => r.source === entity.id)
    .map(r => {
      const target = graph.entities.find(e => e.id === r.target)
      return { type: r.type, target: target?.name || r.target, targetType: target?.type, file: target?.filePath }
    })

  const incoming = graph.relations
    .filter(r => r.target === entity.id)
    .map(r => {
      const source = graph.entities.find(e => e.id === r.source)
      return { type: r.type, source: source?.name || r.source, sourceType: source?.type, file: source?.filePath }
    })

  output({
    command: 'relations',
    entity: { name: entity.name, type: entity.type, file: entity.filePath },
    outgoing,
    incoming,
    totalRelations: outgoing.length + incoming.length,
  })
}

// ---- Callers / Callees / Trace / Blast-Radius / Context / Edit-Context ----

function findEntity(graph: OntologyGraph, name: string): OntologyEntity | undefined {
  return graph.entities.find(e =>
    e.name.toLowerCase() === name.toLowerCase() ||
    e.id.toLowerCase().includes(name.toLowerCase()),
  )
}

function cmdCallers(entityName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const entity = findEntity(graph, entityName)
  if (!entity) { output({ command: 'callers', error: `Entity "${entityName}" not found` }); return }

  // BFS: find all entities that call this entity (reverse traversal through "calls" edges)
  const callers: Array<{ name: string; type: string; file: string; line: number; depth: number }> = []
  const visited = new Set<string>()
  const queue = [{ id: entity.id, d: 0 }]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.d > depth || visited.has(cur.id)) continue
    visited.add(cur.id)
    for (const r of graph.relations) {
      if (r.type === 'calls' && r.target === cur.id && !visited.has(r.source)) {
        const caller = graph.entities.find(e => e.id === r.source)
        if (caller) {
          callers.push({ name: caller.name, type: caller.type, file: caller.filePath, line: caller.line, depth: cur.d + 1 })
          queue.push({ id: caller.id, d: cur.d + 1 })
        }
      }
    }
  }

  output({
    command: 'callers',
    entity: { name: entity.name, type: entity.type, file: entity.filePath, line: entity.line },
    callerCount: callers.length,
    callers,
  })
}

function cmdCallees(entityName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const entity = findEntity(graph, entityName)
  if (!entity) { output({ command: 'callees', error: `Entity "${entityName}" not found` }); return }

  // BFS: find all entities called by this entity (forward traversal through "calls" edges)
  const callees: Array<{ name: string; type: string; file: string; line: number; depth: number }> = []
  const visited = new Set<string>()
  const queue = [{ id: entity.id, d: 0 }]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.d > depth || visited.has(cur.id)) continue
    visited.add(cur.id)
    for (const r of graph.relations) {
      if (r.type === 'calls' && r.source === cur.id && !visited.has(r.target)) {
        const callee = graph.entities.find(e => e.id === r.target)
        if (callee) {
          callees.push({ name: callee.name, type: callee.type, file: callee.filePath, line: callee.line, depth: cur.d + 1 })
          queue.push({ id: callee.id, d: cur.d + 1 })
        }
      }
    }
  }

  output({
    command: 'callees',
    entity: { name: entity.name, type: entity.type, file: entity.filePath, line: entity.line },
    calleeCount: callees.length,
    callees,
  })
}

function cmdTrace(fromName: string, toName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const fromEntity = findEntity(graph, fromName)
  const toEntity = findEntity(graph, toName)
  if (!fromEntity) { output({ command: 'trace', error: `Source entity "${fromName}" not found` }); return }
  if (!toEntity) { output({ command: 'trace', error: `Target entity "${toName}" not found` }); return }

  // BFS to find shortest call path from source to target
  const queue: Array<{ id: string; path: string[] }> = [{ id: fromEntity.id, path: [fromEntity.id] }]
  const visited = new Set<string>()
  let foundPath: string[] | null = null

  while (queue.length > 0 && !foundPath) {
    const cur = queue.shift()!
    if (cur.path.length > depth + 1) continue
    if (visited.has(cur.id)) continue
    visited.add(cur.id)

    if (cur.id === toEntity.id && cur.path.length > 1) {
      foundPath = cur.path
      break
    }

    for (const r of graph.relations) {
      if ((r.type === 'calls' || r.type === 'uses' || r.type === 'imports' || r.type === 'dependsOn') && r.source === cur.id && !visited.has(r.target)) {
        const nextPath = [...cur.path, r.target]
        if (r.target === toEntity.id) { foundPath = nextPath; break }
        queue.push({ id: r.target, path: nextPath })
      }
    }
    if (foundPath) break
  }

  if (!foundPath) {
    output({ command: 'trace', from: fromName, to: toName, found: false, message: 'No call path found between these entities' })
    return
  }

  const hops = foundPath.map((id, i) => {
    const e = graph.entities.find(ent => ent.id === id)
    const edgeType = i > 0 ? graph.relations.find(r =>
      r.source === foundPath![i - 1] && r.target === id &&
      (r.type === 'calls' || r.type === 'uses' || r.type === 'imports' || r.type === 'dependsOn')
    )?.type || 'unknown' : 'start'
    return { name: e?.name || id, type: e?.type, file: e?.filePath, line: e?.line, edgeType }
  })

  output({
    command: 'trace',
    from: fromName,
    to: toName,
    found: true,
    pathLength: foundPath.length - 1,
    hops,
  })
}

function cmdBlastRadius(entityName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const entity = findEntity(graph, entityName)
  if (!entity) { output({ command: 'blast-radius', error: `Entity "${entityName}" not found` }); return }

  // Include the entity's own methods as starting points (class→methods)
  const seeds = [entity.id]
  for (const r of graph.relations) {
    if (r.source === entity.id && r.type === 'contains') seeds.push(r.target)
  }

  // Reverse BFS: find all entities that DEPEND ON this entity (upstream dependents)
  const dependents = new Set<string>()
  const queue = seeds.map(id => ({ id, d: 0 }))
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.d > depth || dependents.has(cur.id)) continue
    dependents.add(cur.id)
    for (const r of graph.relations) {
      if (r.target === cur.id && !dependents.has(r.source) && r.type !== 'contains') {
        queue.push({ id: r.source, d: cur.d + 1 })
      }
    }
  }
  // Remove self and own methods from dependents
  for (const s of seeds) dependents.delete(s)

  const depEntities = graph.entities.filter(e => dependents.has(e.id))
  const byFile = new Map<string, typeof depEntities>()
  for (const e of depEntities) { const l = byFile.get(e.filePath) || []; l.push(e); byFile.set(e.filePath, l) }

  // Risk assessment
  let risk = 'low'
  if (depEntities.length > 30 || byFile.size > 10) risk = 'critical'
  else if (depEntities.length > 15 || byFile.size > 5) risk = 'high'
  else if (depEntities.length > 5 || byFile.size > 2) risk = 'medium'

  output({
    command: 'blast-radius',
    entity: { name: entity.name, type: entity.type, file: entity.filePath, line: entity.line },
    risk,
    dependentCount: depEntities.length,
    affectedFiles: byFile.size,
    byFile: Array.from(byFile.entries()).map(([file, ents]) => ({
      file,
      entities: ents.map(e => ({ name: e.name, type: e.type, line: e.line })),
    })),
  })
}

function cmdContext(query: string, intent: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const docs = buildSearchDocs(fileContents, absPath)

  // Smart context builder: one call returns everything an AI agent needs
  // Intent: explain | modify | debug | test
  const searchResults = tfidfSearch(docs, query, 10)

  // Find matching entities
  const matchedEntities = graph.entities.filter(e =>
    e.name.toLowerCase().includes(query.toLowerCase()) ||
    (e.signature && e.signature.toLowerCase().includes(query.toLowerCase()))
  )

  // For each matched entity, gather context based on intent
  const contextBlocks: Array<{
    entity: { name: string; type: string; file: string; line: number; signature?: string }
    source: string
    callers: Array<{ name: string; type: string; file: string }>
    callees: Array<{ name: string; type: string; file: string }>
    relations: Array<{ direction: string; type: string; entity: string }>
    impactCount: number
  }> = []

  for (const entity of matchedEntities.slice(0, 5)) {
    // Read source
    let source = ''
    if (entity.type !== 'File') {
      const fullPath = path.join(absPath, entity.filePath)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        source = lines.slice(entity.line - 1, entity.endLine).join('\n')
      }
    }

    // Find callers (incoming "calls")
    const callerRels = graph.relations.filter(r => r.type === 'calls' && r.target === entity.id)
    const callers = callerRels.map(r => {
      const e = graph.entities.find(ent => ent.id === r.source)
      return e ? { name: e.name, type: e.type, file: e.filePath } : null
    }).filter(Boolean) as Array<{ name: string; type: string; file: string }>

    // Find callees (outgoing "calls")
    const calleeRels = graph.relations.filter(r => r.type === 'calls' && r.source === entity.id)
    const callees = calleeRels.map(r => {
      const e = graph.entities.find(ent => ent.id === r.target)
      return e ? { name: e.name, type: e.type, file: e.filePath } : null
    }).filter(Boolean) as Array<{ name: string; type: string; file: string }>

    // All relations
    const rels = graph.relations.filter(r => r.source === entity.id || r.target === entity.id)
    const relDetails = rels.map(r => {
      const other = graph.entities.find(e => e.id === (r.source === entity.id ? r.target : r.source))
      return { direction: r.source === entity.id ? 'out' : 'in', type: r.type, entity: other?.name || 'unknown' }
    })

    // Impact count
    const impacted = getImpactedEntities(entity.id, graph, depth)

    contextBlocks.push({
      entity: { name: entity.name, type: entity.type, file: entity.filePath, line: entity.line, signature: entity.signature },
      source: source.substring(0, 3000),
      callers,
      callees,
      relations: relDetails,
      impactCount: impacted.size - 1,
    })
  }

  output({
    command: 'context',
    query,
    intent: intent || 'explain',
    matchedEntities: matchedEntities.length,
    context: contextBlocks,
    searchResults: searchResults.slice(0, 5),
  })
}

function cmdEditContext(entityName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const entity = findEntity(graph, entityName)
  if (!entity) { output({ command: 'edit-context', error: `Entity "${entityName}" not found` }); return }

  // Pre-edit analysis: source + callers + callees + tests + siblings + impact
  let source = ''
  const fullPath = path.join(absPath, entity.filePath)
  if (entity.type !== 'File' && fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8')
    const lines = content.split('\n')
    source = lines.slice(entity.line - 1, entity.endLine).join('\n')
  }

  // Callers
  const callerRels = graph.relations.filter(r => r.type === 'calls' && r.target === entity.id)
  const callers = callerRels.map(r => {
    const e = graph.entities.find(ent => ent.id === r.source)
    if (!e) return null
    let callerSource = ''
    const cPath = path.join(absPath, e.filePath)
    if (e.type !== 'File' && fs.existsSync(cPath)) {
      const c = fs.readFileSync(cPath, 'utf-8').split('\n')
      callerSource = c.slice(e.line - 1, e.endLine).join('\n')
    }
    return { name: e.name, type: e.type, file: e.filePath, line: e.line, source: callerSource.substring(0, 2000) }
  }).filter(Boolean)

  // Callees
  const calleeRels = graph.relations.filter(r => r.type === 'calls' && r.source === entity.id)
  const callees = calleeRels.map(r => {
    const e = graph.entities.find(ent => ent.id === r.target)
    if (!e) return null
    let calleeSource = ''
    const cPath = path.join(absPath, e.filePath)
    if (e.type !== 'File' && fs.existsSync(cPath)) {
      const c = fs.readFileSync(cPath, 'utf-8').split('\n')
      calleeSource = c.slice(e.line - 1, e.endLine).join('\n')
    }
    return { name: e.name, type: e.type, file: e.filePath, line: e.line, source: calleeSource.substring(0, 2000) }
  }).filter(Boolean)

  // Find test-related entities (look for entities with "test" or "spec" in name or file)
  const testEntities = graph.entities.filter(e => {
    const name = e.name.toLowerCase()
    const file = e.filePath.toLowerCase()
    return (name.includes('test') || name.includes('spec') || file.includes('test') || file.includes('spec') || file.includes('__tests__')) &&
      graph.relations.some(r => (r.source === e.id && r.target === entity.id) || (r.target === e.id && r.source === entity.id))
  })

  // Siblings
  const siblings = graph.entities.filter(e =>
    e.filePath === entity.filePath && e.id !== entity.id && e.type !== 'File'
  ).map(e => ({ name: e.name, type: e.type, line: e.line }))

  // Impact
  const impacted = getImpactedEntities(entity.id, graph, depth)
  const impactedEntities = graph.entities.filter(e => impacted.has(e.id) && e.id !== entity.id)

  // Blast radius (reverse)
  const dependents = new Set<string>()
  const queue = [{ id: entity.id, d: 0 }]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.d > depth || dependents.has(cur.id)) continue
    dependents.add(cur.id)
    for (const r of graph.relations) {
      if (r.target === cur.id && !dependents.has(r.source) && r.type !== 'contains') {
        queue.push({ id: r.source, d: cur.d + 1 })
      }
    }
  }
  dependents.delete(entity.id)

  output({
    command: 'edit-context',
    entity: {
      name: entity.name, type: entity.type, file: entity.filePath,
      line: entity.line, endLine: entity.endLine, signature: entity.signature,
    },
    source: source.substring(0, 5000),
    callers,
    callees,
    relatedTests: testEntities.map(e => ({ name: e.name, type: e.type, file: e.filePath, line: e.line })),
    siblings,
    forwardImpact: impactedEntities.length,
    blastRadius: dependents.size,
    warnings: [
      ...(callers.length > 10 ? [`${callers.length} callers: high coupling — edit carefully`] : []),
      ...(dependents.size > 20 ? [`Blast radius ${dependents.size}: changes will ripple widely`] : []),
      ...(testEntities.length === 0 ? ['No tests found: consider adding test coverage before editing'] : []),
    ],
  })
}

// ---- Explore: multi-symbol source grouped by file ----

function cmdExplore(entityNames: string[], projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)

  const found: Array<{ name: string; type: string; file: string; line: number; endLine: number; source: string }> = []
  const notFound: string[] = []

  for (const name of entityNames) {
    const entity = findEntity(graph, name)
    if (!entity) { notFound.push(name); continue }
    let source = ''
    if (entity.type !== 'File') {
      const fullPath = path.join(absPath, entity.filePath)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8').split('\n')
        source = content.slice(entity.line - 1, entity.endLine).join('\n')
      }
    }
    found.push({ name: entity.name, type: entity.type, file: entity.filePath, line: entity.line, endLine: entity.endLine, source: source.substring(0, 3000) })
  }

  // Group by file
  const byFile = new Map<string, typeof found>()
  for (const e of found) { const l = byFile.get(e.file) || []; l.push(e); byFile.set(e.file, l) }

  // Relationship map between found entities
  const relationships: Array<{ from: string; to: string; type: string }> = []
  const foundIds = new Set(found.map(f => {
    const e = findEntity(graph, f.name)
    return e?.id || ''
  }).filter(Boolean))

  for (const r of graph.relations) {
    if (foundIds.has(r.source) && foundIds.has(r.target)) {
      const src = graph.entities.find(e => e.id === r.source)
      const tgt = graph.entities.find(e => e.id === r.target)
      if (src && tgt) relationships.push({ from: src.name, to: tgt.name, type: r.type })
    }
  }

  output({
    command: 'explore',
    found: found.length,
    notFound,
    byFile: Array.from(byFile.entries()).map(([file, symbols]) => ({
      file,
      symbols: symbols.map(s => ({ name: s.name, type: s.type, line: s.line, endLine: s.endLine, source: s.source })),
    })),
    relationships,
  })
}

// ---- Dependency Path: shortest path between two symbols ----

function cmdDependencyPath(fromName: string, toName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const fromEntity = findEntity(graph, fromName)
  const toEntity = findEntity(graph, toName)
  if (!fromEntity) { output({ command: 'dependency-path', error: `Source entity "${fromName}" not found` }); return }
  if (!toEntity) { output({ command: 'dependency-path', error: `Target entity "${toName}" not found` }); return }

  // BFS for shortest path using ALL relation types (bidirectional)
  const queue: Array<{ id: string; path: Array<{ entityId: string; edgeType: string }> }> = [
    { id: fromEntity.id, path: [{ entityId: fromEntity.id, edgeType: 'start' }] },
  ]
  const visited = new Set<string>()
  let foundPath: Array<{ entityId: string; edgeType: string }> | null = null

  while (queue.length > 0 && !foundPath) {
    const cur = queue.shift()!
    if (cur.path.length > depth + 1) continue
    if (visited.has(cur.id)) continue
    visited.add(cur.id)

    for (const r of graph.relations) {
      if (r.type === 'contains') continue
      let nextId: string | null = null
      let edgeLabel = ''
      if (r.source === cur.id) { nextId = r.target; edgeLabel = `--${r.type}-->` }
      else if (r.target === cur.id) { nextId = r.source; edgeLabel = `<--${r.type}--` }
      if (!nextId || visited.has(nextId)) continue

      const nextPath = [...cur.path, { entityId: nextId, edgeType: edgeLabel }]
      if (nextId === toEntity.id) { foundPath = nextPath; break }
      queue.push({ id: nextId, path: nextPath })
    }
    if (foundPath) break
  }

  if (!foundPath) {
    output({ command: 'dependency-path', from: fromName, to: toName, found: false, message: 'No dependency path found' })
    return
  }

  const hops = foundPath.map(h => {
    const e = graph.entities.find(ent => ent.id === h.entityId)
    return { name: e?.name || h.entityId, type: e?.type, file: e?.filePath, line: e?.line, edge: h.edgeType }
  })

  output({
    command: 'dependency-path',
    from: fromName,
    to: toName,
    found: true,
    pathLength: foundPath.length - 1,
    hops,
  })
}

// ---- File Context: all imports/exports/symbols for a file ----

function cmdFileContext(filePath: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const relFile = filePath.replace(/\\/g, '/')

  const fileEntity = graph.entities.find(e =>
    e.type === 'File' && e.filePath.replace(/\\/g, '/').endsWith(relFile)
  )
  if (!fileEntity) { output({ command: 'file-context', error: `File "${filePath}" not found in index` }); return }

  // All entities defined in this file
  const defined = graph.entities.filter(e => e.filePath === fileEntity.filePath && e.type !== 'File')

  // Imports (outgoing "imports" from file or entities in file)
  const fileEntityIds = new Set([fileEntity.id, ...defined.map(e => e.id)])
  const imports: Array<{ name: string; type: string; file: string }> = []
  const exports: Array<{ name: string; type: string; line: number }> = []

  for (const r of graph.relations) {
    if (r.type === 'imports' && fileEntityIds.has(r.source)) {
      const target = graph.entities.find(e => e.id === r.target)
      if (target && !fileEntityIds.has(target.id)) {
        imports.push({ name: target.name, type: target.type, file: target.filePath })
      }
    }
    if (r.type === 'exports' && fileEntityIds.has(r.source)) {
      const target = graph.entities.find(e => e.id === r.target)
      if (target) exports.push({ name: target.name, type: target.type, line: target.line })
    }
  }

  // If exports is empty, fall back to defined entities as exported
  const effectiveExports = exports.length > 0 ? exports : defined.map(e => ({ name: e.name, type: e.type, line: e.line }))

  output({
    command: 'file-context',
    file: fileEntity.filePath,
    definedSymbols: defined.map(e => ({ name: e.name, type: e.type, line: e.line, signature: e.signature })),
    imports,
    exports: effectiveExports,
    symbolCount: defined.length,
  })
}

// ---- Complexity Analysis ----

function cmdComplexity(entityName: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const entity = findEntity(graph, entityName)
  if (!entity) { output({ command: 'complexity', error: `Entity "${entityName}" not found` }); return }

  let source = ''
  if (entity.type !== 'File') {
    const fullPath = path.join(absPath, entity.filePath)
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8').split('\n')
      source = content.slice(entity.line - 1, entity.endLine).join('\n')
    }
  }

  // Simple cyclomatic complexity analysis
  const branches = (source.match(/\bif\b|\belse\s+if\b|\bcase\b|\bcatch\b|\b\?\s/g) || []).length
  const loops = (source.match(/\bfor\b|\bwhile\b|\bdo\b|\b\.forEach\b|\b\.map\b|\b\.filter\b|\b\.reduce\b/g) || []).length
  const conditions = (source.match(/&&|\|\|/g) || []).length
  const lines = source.split('\n').length
  const nesting = Math.max(0, ...(source.match(/^(\s*)/gm) || []).map(s => Math.floor(s.length / 2)))

  const cyclomatic = 1 + branches + conditions
  let grade = 'A'
  if (cyclomatic > 20) grade = 'F'
  else if (cyclomatic > 15) grade = 'D'
  else if (cyclomatic > 10) grade = 'C'
  else if (cyclomatic > 5) grade = 'B'

  // Coupling metrics
  const outgoing = graph.relations.filter(r => r.source === entity.id).length
  const incoming = graph.relations.filter(r => r.target === entity.id).length

  output({
    command: 'complexity',
    entity: { name: entity.name, type: entity.type, file: entity.filePath },
    metrics: {
      cyclomaticComplexity: cyclomatic,
      grade,
      lines,
      branches,
      loops,
      conditions,
      maxNesting: nesting,
      couplingOut: outgoing,
      couplingIn: incoming,
    },
  })
}

// ---- LSIF/SCIP Support ----

interface ScipOccurrence {
  symbol: string
  range: number[]
  role: 'definition' | 'reference'
}

interface ScipDocument {
  relativePath: string
  occurrences: ScipOccurrence[]
}

function parseLsifIndex(projectPath: string): { documents: ScipDocument[] } | null {
  // Look for LSIF/SCIP index files
  const candidates = ['index.scip', 'dump.lsif', 'index.lsif', '.codewiki/index.scip']
  let indexPath: string | null = null
  for (const c of candidates) {
    const p = path.join(projectPath, c)
    if (fs.existsSync(p)) { indexPath = p; break }
  }
  if (!indexPath) return null

  const ext = path.extname(indexPath)
  if (ext === '.scip') {
    return parseScipJson(indexPath)
  }
  return parseLsifJson(indexPath)
}

function parseScipJson(filePath: string): { documents: ScipDocument[] } | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (!data.documents) return null
    return {
      documents: data.documents.map((doc: { relativePath: string; occurrences?: Array<{ symbol: string; range: number[]; symbolRoles?: number }> }) => ({
        relativePath: doc.relativePath,
        occurrences: (doc.occurrences || []).map((occ: { symbol: string; range: number[]; symbolRoles?: number }) => ({
          symbol: occ.symbol,
          range: occ.range,
          role: (occ.symbolRoles && occ.symbolRoles & 1) ? 'definition' as const : 'reference' as const,
        })),
      })),
    }
  } catch { return null }
}

function parseLsifJson(filePath: string): { documents: ScipDocument[] } | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter(l => l.trim())
    const documents: ScipDocument[] = []
    const vertices = new Map<string, { type: string; data?: unknown; uri?: string }>()
    const edges = new Map<string, { type: string; outV: string; inVs?: string[] }>()

    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.type === 'vertex') vertices.set(obj.id, obj)
        else if (obj.type === 'edge') edges.set(obj.id, obj)
      } catch { continue }
    }

    // Group by document
    const docMap = new Map<string, ScipOccurrence[]>()
    for (const [, v] of vertices) {
      if (v.type === 'document' && v.uri) {
        const relPath = v.uri.replace(/^file:\/\//, '').replace(filePath.replace(/[^/\\]+$/, ''), '')
        docMap.set(relPath, [])
      }
    }

    if (docMap.size > 0) {
      documents.push(...Array.from(docMap.entries()).map(([relativePath, occurrences]) => ({
        relativePath,
        occurrences,
      })))
    }

    return documents.length > 0 ? { documents } : null
  } catch { return null }
}

function enrichGraphWithLsif(graph: OntologyGraph, lsif: { documents: ScipDocument[] }, projectPath: string): void {
  // Enrich the ontology graph with compiler-accurate definition/reference data from LSIF/SCIP
  for (const doc of lsif.documents) {
    for (const occ of doc.occurrences) {
      if (occ.role === 'reference') {
        // Find the entity being referenced
        const symbolName = occ.symbol.split('/').pop()?.replace(/#$/, '') || ''
        const refLine = (occ.range[0] || 0) + 1

        // Find matching entity definition
        const defEntity = graph.entities.find(e => e.name === symbolName && e.type !== 'File')
        if (!defEntity) continue

        // Find the entity at the reference site
        const refEntity = graph.entities.find(e =>
          e.filePath.replace(/\\/g, '/') === doc.relativePath.replace(/\\/g, '/') &&
          e.line <= refLine && e.endLine >= refLine && e.type !== 'File'
        )
        if (!refEntity || refEntity.id === defEntity.id) continue

        // Check if a relation already exists
        const exists = graph.relations.some(r =>
          r.source === refEntity.id && r.target === defEntity.id &&
          (r.type === 'calls' || r.type === 'uses')
        )
        if (!exists) {
          graph.relations.push({
            id: `lsif-ref-${graph.relations.length}`,
            source: refEntity.id,
            target: defEntity.id,
            type: 'uses',
            confidence: 0.95, // LSIF/SCIP references are compiler-accurate
          })
        }
      }
    }
  }
}

function cmdLsifStatus(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const lsif = parseLsifIndex(absPath)

  if (!lsif) {
    output({
      command: 'lsif',
      status: 'not-found',
      message: 'No LSIF/SCIP index found. Generate one with: scip-typescript index (for TS/JS), scip-python (for Python), scip-java (for Java/Kotlin/Scala)',
      supportedFormats: ['index.scip', 'dump.lsif', 'index.lsif'],
      generators: {
        'TypeScript/JavaScript': 'npm install -g @sourcegraph/scip-typescript && scip-typescript index',
        'Python': 'pip install scip-python && scip-python index',
        'Java/Kotlin/Scala': 'See https://github.com/sourcegraph/scip-java',
        'Rust': 'rust-analyzer scip .',
        'Go': 'See https://github.com/sourcegraph/scip-go',
      },
    })
    return
  }

  const totalOccurrences = lsif.documents.reduce((sum, d) => sum + d.occurrences.length, 0)
  const defs = lsif.documents.reduce((sum, d) => sum + d.occurrences.filter(o => o.role === 'definition').length, 0)
  const refs = lsif.documents.reduce((sum, d) => sum + d.occurrences.filter(o => o.role === 'reference').length, 0)

  output({
    command: 'lsif',
    status: 'found',
    documents: lsif.documents.length,
    totalOccurrences,
    definitions: defs,
    references: refs,
    message: 'LSIF/SCIP index will be used to enrich ontology with compiler-accurate references',
  })
}

// ---- Dead Code Detection ----

function cmdDeadCode(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)

  const deadCode: Array<{
    name: string
    type: string
    file: string
    line: number
    category: 'orphan' | 'exported-unused' | 'internal-unused'
  }> = []

  for (const entity of graph.entities) {
    if (entity.type === 'File') continue

    // Check if this entity is referenced by anyone
    const incomingRels = graph.relations.filter(r =>
      r.target === entity.id && r.type !== 'contains'
    )
    const outgoingContains = graph.relations.filter(r =>
      r.source === entity.id && r.type === 'contains'
    )

    // Skip entities that contain others (classes with methods)
    if (outgoingContains.length > 0 && entity.type === 'Class') continue

    if (incomingRels.length === 0) {
      // Check if exported
      const isExported = entity.signature?.startsWith('export') || false
      // Check if it's a test entity
      const isTest = entity.filePath.includes('test') || entity.filePath.includes('spec') || entity.name.includes('Test') || entity.name.includes('test')
      // Check if entry point
      const isEntryPoint = entity.name === 'main' || entity.name === 'default' ||
        entity.filePath.includes('index.') || entity.filePath.includes('app.') ||
        entity.filePath.includes('server.') || entity.filePath.includes('main.')

      if (isTest || isEntryPoint) continue

      let category: 'orphan' | 'exported-unused' | 'internal-unused'
      if (!isExported) {
        category = 'orphan'
      } else {
        // Exported but never imported by anything in this project
        const importedAnywhere = graph.relations.some(r =>
          r.target === entity.id && (r.type === 'imports' || r.type === 'uses')
        )
        category = importedAnywhere ? 'exported-unused' : 'exported-unused'
      }

      deadCode.push({
        name: entity.name,
        type: entity.type,
        file: entity.filePath,
        line: entity.line,
        category,
      })
    }
  }

  // Group by file
  const byFile = new Map<string, typeof deadCode>()
  for (const d of deadCode) { const l = byFile.get(d.file) || []; l.push(d); byFile.set(d.file, l) }

  output({
    command: 'dead-code',
    totalDead: deadCode.length,
    byCategory: {
      orphan: deadCode.filter(d => d.category === 'orphan').length,
      exportedUnused: deadCode.filter(d => d.category === 'exported-unused').length,
      internalUnused: deadCode.filter(d => d.category === 'internal-unused').length,
    },
    byFile: Array.from(byFile.entries()).map(([file, items]) => ({
      file,
      symbols: items.map(d => ({ name: d.name, type: d.type, line: d.line, category: d.category })),
    })),
  })
}

// ---- Health Score (circular deps + dead code + coupling + god objects) ----

const HEALTH_DEP_RELS = new Set(['imports', 'dependsOn', 'calls', 'uses', 'extends', 'implements'])

/** File-level circular dependency detection via iterative Tarjan SCC. */
function detectCyclesCli(graph: OntologyGraph): Array<{ files: string[]; edges: number }> {
  const byId = new Map<string, OntologyEntity>()
  for (const e of graph.entities) byId.set(e.id, e)
  const adj = new Map<string, Set<string>>()
  const edgeCount = new Map<string, number>()
  const ensure = (f: string) => { if (!adj.has(f)) adj.set(f, new Set()) }
  for (const r of graph.relations) {
    if (!HEALTH_DEP_RELS.has(r.type)) continue
    const s = byId.get(r.source); const t = byId.get(r.target)
    if (!s || !t || !s.filePath || !t.filePath || s.filePath === t.filePath) continue
    ensure(s.filePath); ensure(t.filePath)
    adj.get(s.filePath)!.add(t.filePath)
    const k = `${s.filePath}|${t.filePath}`
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1)
  }
  let index = 0
  const idx = new Map<string, number>(); const low = new Map<string, number>()
  const onStack = new Set<string>(); const stack: string[] = []
  const sccs: string[][] = []
  for (const start of adj.keys()) {
    if (idx.has(start)) continue
    const work: Array<{ v: string; iter: Iterator<string> }> = [{ v: start, iter: adj.get(start)!.values() }]
    idx.set(start, index); low.set(start, index); index++; stack.push(start); onStack.add(start)
    while (work.length) {
      const top = work[work.length - 1]
      const next = top.iter.next()
      if (!next.done) {
        const w = next.value
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index++; stack.push(w); onStack.add(w)
          work.push({ v: w, iter: (adj.get(w) || new Set()).values() })
        } else if (onStack.has(w)) {
          low.set(top.v, Math.min(low.get(top.v)!, idx.get(w)!))
        }
      } else {
        if (low.get(top.v) === idx.get(top.v)) {
          const comp: string[] = []; let w: string
          do { w = stack.pop()!; onStack.delete(w); comp.push(w) } while (w !== top.v)
          if (comp.length > 1) sccs.push(comp)
        }
        work.pop()
        if (work.length) { const p = work[work.length - 1].v; low.set(p, Math.min(low.get(p)!, low.get(top.v)!)) }
      }
    }
  }
  return sccs.map(files => {
    let edges = 0
    for (const a of files) for (const b of files) { if (a !== b) edges += edgeCount.get(`${a}|${b}`) || 0 }
    return { files: files.sort(), edges }
  }).sort((a, b) => b.files.length - a.files.length || b.edges - a.edges)
}

function ratioScoreCli(ratio: number, cap: number): number {
  return Math.round(100 * (1 - Math.max(0, Math.min(cap, ratio)) / cap))
}

function cmdHealth(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)
  const code = graph.entities.filter(e => e.type !== 'File' && e.type !== 'Module' && e.type !== 'Package')
  const files = new Set(graph.entities.map(e => e.filePath).filter(Boolean))

  const cycles = detectCyclesCli(graph)
  // Dead code (same heuristic as cmdDeadCode, count only).
  let dead = 0
  for (const e of code) {
    const incoming = graph.relations.filter(r => r.target === e.id && r.type !== 'contains')
    const containsOthers = graph.relations.some(r => r.source === e.id && r.type === 'contains')
    if (containsOthers && e.type === 'Class') continue
    if (incoming.length > 0) continue
    if (/test|spec|__mocks__/i.test(e.filePath) || /test/i.test(e.name)) continue
    if (e.name === 'main' || e.name === 'default' || /(^|\/)(index|app|server|main)\./i.test(e.filePath)) continue
    dead++
  }
  // Coupling + god objects.
  const fanOut = new Map<string, number>(); const members = new Map<string, number>()
  let depRel = 0
  for (const r of graph.relations) {
    if (r.type === 'contains') { members.set(r.source, (members.get(r.source) || 0) + 1); continue }
    if (!HEALTH_DEP_RELS.has(r.type)) continue
    depRel++
    fanOut.set(r.source, (fanOut.get(r.source) || 0) + 1)
  }
  let godObjects = 0
  for (const e of code) {
    if ((fanOut.get(e.id) || 0) >= 20 || (members.get(e.id) || 0) >= 20) godObjects++
  }
  const avgDegree = code.length ? depRel / code.length : 0
  const deadRatio = code.length ? dead / code.length : 0
  const cycleRatio = files.size ? cycles.reduce((n, c) => n + c.files.length, 0) / files.size : 0
  const godRatio = code.length ? godObjects / code.length : 0

  const components = [
    { key: 'circularDeps', weight: 0.3, score: ratioScoreCli(cycleRatio, 0.3), detail: `${cycles.length} cycles` },
    { key: 'deadCode', weight: 0.25, score: ratioScoreCli(deadRatio, 0.4), detail: `${dead} (${Math.round(deadRatio * 100)}%)` },
    { key: 'coupling', weight: 0.2, score: ratioScoreCli(Math.max(0, avgDegree - 2), 8), detail: avgDegree.toFixed(2) },
    { key: 'godObjects', weight: 0.15, score: ratioScoreCli(godRatio, 0.1), detail: `${godObjects}` },
    { key: 'security', weight: 0.1, score: 100, detail: 'n/a (use `codewiki scan`)' },
  ]
  const totalW = components.reduce((s, c) => s + c.weight, 0)
  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0) / totalW)
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F'

  output({
    command: 'health',
    score,
    grade,
    components,
    metrics: {
      entityCount: graph.entities.length,
      relationCount: graph.relations.length,
      fileCount: files.size,
      avgDegree: Number(avgDegree.toFixed(2)),
      deadCode: dead,
      circularDependencies: cycles.length,
      godObjects,
    },
    topCycles: cycles.slice(0, 10).map(c => ({ files: c.files, edges: c.edges })),
  })
}

// ---- Git churn / ownership (CodeFlow-inspired) ----

interface CliFileChurn {
  path: string
  commits: number
  linesChanged: number
  lastCommit: number
  authors: Array<{ name: string; commits: number }>
}

function normalizeRenameCli(raw: string): string {
  let p = raw.trim()
  if (!p) return ''
  const brace = p.match(/\{(.*?) => (.*?)\}/)
  if (brace) p = p.replace(/\{(.*?) => (.*?)\}/, brace[2])
  else if (p.includes(' => ')) p = p.split(' => ').pop() || p
  return p.replace(/\/\//g, '/').trim()
}

function runGitChurn(absPath: string): { files: CliFileChurn[]; maxCommits: number; totalCommits: number } | null {
  const res = spawnSync('git', ['-C', absPath, 'log', '--no-merges', '--pretty=format:C|%H|%an|%at', '--numstat'], {
    encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
  })
  if (res.status !== 0 || !res.stdout) return null
  const lines = res.stdout.split('\n')
  let cur: { hash: string; author: string; ts: number } | null = null
  const commitsByFile = new Map<string, Set<string>>()
  const linesByFile = new Map<string, number>()
  const lastByFile = new Map<string, number>()
  const authorsByFile = new Map<string, Map<string, Set<string>>>()
  const allCommits = new Set<string>()
  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('C|')) {
      const [, hash, author, at] = line.split('|')
      cur = { hash: hash || '', author: author || 'unknown', ts: parseInt(at || '0', 10) || 0 }
      if (cur.hash) allCommits.add(cur.hash)
      continue
    }
    const parts = line.split('\t')
    if (parts.length < 3 || !cur) continue
    const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
    const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
    const fp = normalizeRenameCli(parts.slice(2).join('\t'))
    if (!fp) continue
    if (!commitsByFile.has(fp)) commitsByFile.set(fp, new Set())
    commitsByFile.get(fp)!.add(cur.hash)
    linesByFile.set(fp, (linesByFile.get(fp) || 0) + added + deleted)
    lastByFile.set(fp, Math.max(lastByFile.get(fp) || 0, cur.ts))
    if (!authorsByFile.has(fp)) authorsByFile.set(fp, new Map())
    const am = authorsByFile.get(fp)!
    if (!am.has(cur.author)) am.set(cur.author, new Set())
    am.get(cur.author)!.add(cur.hash)
  }
  const files: CliFileChurn[] = []
  for (const [p, set] of commitsByFile) {
    const am = authorsByFile.get(p) || new Map<string, Set<string>>()
    const authors = Array.from(am.entries()).map(([name, s]) => ({ name, commits: s.size })).sort((a, b) => b.commits - a.commits)
    files.push({ path: p, commits: set.size, linesChanged: linesByFile.get(p) || 0, lastCommit: lastByFile.get(p) || 0, authors })
  }
  files.sort((a, b) => b.commits - a.commits)
  return { files, maxCommits: files.reduce((m, f) => Math.max(m, f.commits), 0), totalCommits: allCommits.size }
}

function cmdChurn(projectPath: string, topN: number): void {
  const absPath = path.resolve(projectPath)
  const report = runGitChurn(absPath)
  if (!report) { output({ command: 'churn', error: 'Not a git repository or git unavailable' }); return }
  output({
    command: 'churn',
    totalCommits: report.totalCommits,
    maxCommits: report.maxCommits,
    hotFiles: report.files.slice(0, topN || 20).map(f => ({
      path: f.path,
      commits: f.commits,
      linesChanged: f.linesChanged,
      lastCommit: new Date(f.lastCommit * 1000).toISOString(),
      topAuthor: f.authors[0]?.name,
      authorCount: f.authors.length,
    })),
  })
}

function cmdOwnership(filePath: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const report = runGitChurn(absPath)
  if (!report) { output({ command: 'ownership', error: 'Not a git repository or git unavailable' }); return }
  const needle = filePath.replace(/\\/g, '/')
  const match = report.files.find(f => f.path === needle || f.path.endsWith('/' + needle) || f.path.endsWith(needle))
  if (!match) { output({ command: 'ownership', file: filePath, error: 'No history found for file' }); return }
  output({
    command: 'ownership',
    file: match.path,
    commits: match.commits,
    linesChanged: match.linesChanged,
    lastCommit: new Date(match.lastCommit * 1000).toISOString(),
    owners: match.authors.map(a => ({ name: a.name, commits: a.commits, share: Math.round((a.commits / match.commits) * 100) })),
  })
}

// ---- Security scan (CodeFlow-inspired) ----

interface SecRule { id: string; severity: 'high' | 'medium' | 'low'; message: string; test: RegExp; skipComments?: boolean; mask?: boolean }

const SEC_RULES: SecRule[] = [
  { id: 'hardcoded-secret', severity: 'high', message: 'Possible hardcoded secret / credential', test: /(?:secret|token|password|passwd|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token)\s*[:=]\s*["'][^"']{6,}["']/i, mask: true },
  { id: 'known-token', severity: 'high', message: 'Hardcoded provider token', test: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/, mask: true, skipComments: false },
  { id: 'private-key', severity: 'high', message: 'Embedded private key block', test: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, skipComments: false },
  { id: 'eval-usage', severity: 'high', message: 'Use of eval()', test: /\beval\s*\(/ },
  { id: 'function-constructor', severity: 'medium', message: 'Function constructor (eval-like)', test: /\bnew\s+Function\s*\(/ },
  { id: 'sql-injection', severity: 'high', message: 'SQL built via concatenation/interpolation', test: /(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*?(?:["'`]\s*\+|\$\{|%s|\+\s*["'`])/i },
  { id: 'shell-injection', severity: 'high', message: 'Shell command built with concatenation', test: /\b(?:exec|execSync|spawnSync|popen|system|os\.system|subprocess\.(?:call|run|Popen))\s*\([^)]*(?:\+|\$\{|%\s|`[^`]*\$\{)/ },
  { id: 'dangerous-html', severity: 'medium', message: 'innerHTML / dangerouslySetInnerHTML (XSS)', test: /(?:\.innerHTML\s*=|dangerouslySetInnerHTML)/ },
  { id: 'debug-statement', severity: 'low', message: 'Debug statement left in code', test: /\b(?:console\.(?:log|debug|trace)|debugger|System\.out\.println|fmt\.Println)\b/ },
  { id: 'insecure-random', severity: 'low', message: 'Math.random() not cryptographically secure', test: /\bMath\.random\s*\(/ },
  { id: 'http-url', severity: 'low', message: 'Cleartext http:// URL', test: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/ },
]

function maskSecretLine(line: string): string {
  return line.replace(/(["'])([^"']{6,})\1/g, (_m, q) => `${q}***${q}`)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|sk-[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{6,}|xox[baprs]-[A-Za-z0-9-]{6,})\b/g, '***')
}

function cmdScan(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { fileContents } = getGraph(absPath)
  const findings: Array<{ file: string; line: number; rule: string; severity: string; message: string; snippet: string }> = []
  const commentRe = /^\s*(?:\/\/|#|\*|<!--)/
  let scanned = 0
  for (const [fp, content] of fileContents) {
    if (!content) continue
    if (/(^|\/)(node_modules|dist|build|out|vendor|\.min\.)/.test(fp) || /\.(test|spec)\.[tj]sx?$/.test(fp)) continue
    scanned++
    const rel = path.relative(absPath, fp) || fp
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 1000) continue
      const isComment = commentRe.test(line)
      for (const rule of SEC_RULES) {
        if (isComment && rule.skipComments !== false) continue
        if (rule.test.test(line)) {
          const raw = line.trim().slice(0, 200)
          findings.push({ file: rel, line: i + 1, rule: rule.id, severity: rule.severity, message: rule.message, snippet: rule.mask ? maskSecretLine(raw) : raw })
        }
      }
    }
  }
  const bySeverity = { high: 0, medium: 0, low: 0 }
  const byRule: Record<string, number> = {}
  for (const f of findings) { bySeverity[f.severity as 'high' | 'medium' | 'low']++; byRule[f.rule] = (byRule[f.rule] || 0) + 1 }
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)
  output({ command: 'scan', filesScanned: scanned, total: findings.length, bySeverity, byRule, findings })
}

// ---- Find References ----

function cmdFindReferences(entityName: string, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const entity = findEntity(graph, entityName)
  if (!entity) { output({ command: 'find-references', error: `Entity "${entityName}" not found` }); return }

  // Find all usages: relations where this entity is the target, plus text search
  const graphRefs: Array<{ name: string; type: string; file: string; line: number; relationType: string }> = []

  for (const r of graph.relations) {
    if (r.target === entity.id && r.type !== 'contains') {
      const src = graph.entities.find(e => e.id === r.source)
      if (src) {
        graphRefs.push({ name: src.name, type: src.type, file: src.filePath, line: src.line, relationType: r.type })
      }
    }
  }

  // Text-based reference search across all files
  const textRefs: Array<{ file: string; line: number; context: string }> = []
  const nameRegex = new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')

  for (const [filePath, content] of fileContents) {
    const relPath = path.relative(absPath, filePath)
    // Skip the definition file at the definition line
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (relPath.replace(/\\/g, '/') === entity.filePath.replace(/\\/g, '/') && i + 1 === entity.line) continue
      if (nameRegex.test(lines[i])) {
        textRefs.push({ file: relPath, line: i + 1, context: lines[i].trim().substring(0, 120) })
      }
      nameRegex.lastIndex = 0
    }
  }

  output({
    command: 'find-references',
    entity: { name: entity.name, type: entity.type, file: entity.filePath, line: entity.line },
    graphReferences: graphRefs,
    textReferences: textRefs.slice(0, 50),
    totalGraphRefs: graphRefs.length,
    totalTextRefs: textRefs.length,
  })
}

// ---- PageRank (Key Symbol Identification) ----

function cmdPageRank(projectPath: string, topN: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)

  // Build adjacency for PageRank (ignore File entities and contains relations)
  const entities = graph.entities.filter(e => e.type !== 'File')
  const entityMap = new Map(entities.map(e => [e.id, e]))
  const outLinks = new Map<string, string[]>()
  const inLinks = new Map<string, string[]>()

  for (const e of entities) {
    outLinks.set(e.id, [])
    inLinks.set(e.id, [])
  }

  for (const r of graph.relations) {
    if (r.type === 'contains') continue
    if (!entityMap.has(r.source) || !entityMap.has(r.target)) continue
    outLinks.get(r.source)?.push(r.target)
    inLinks.get(r.target)?.push(r.source)
  }

  // PageRank iteration
  const damping = 0.85
  const iterations = 20
  const n = entities.length
  if (n === 0) { output({ command: 'pagerank', results: [] }); return }

  let ranks = new Map<string, number>()
  for (const e of entities) ranks.set(e.id, 1 / n)

  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>()
    for (const e of entities) {
      let sum = 0
      for (const src of (inLinks.get(e.id) || [])) {
        const srcOut = outLinks.get(src)?.length || 1
        sum += (ranks.get(src) || 0) / srcOut
      }
      newRanks.set(e.id, (1 - damping) / n + damping * sum)
    }
    ranks = newRanks
  }

  // Sort by rank and return top N
  const sorted = entities
    .map(e => ({
      name: e.name,
      type: e.type,
      file: e.filePath,
      line: e.line,
      rank: ranks.get(e.id) || 0,
      inDegree: inLinks.get(e.id)?.length || 0,
      outDegree: outLinks.get(e.id)?.length || 0,
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, topN)

  output({
    command: 'pagerank',
    totalEntities: entities.length,
    results: sorted,
  })
}

// ---- HTTP Route Tracing ----

function cmdTraceRoute(routePath: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)

  // Find route handlers by searching for HTTP method + path patterns
  const routePatterns = [
    // Express: app.get('/api/users', handler), router.post('/api/users', handler)
    new RegExp(`(?:app|router)\\s*\\.\\s*(?:get|post|put|delete|patch|all|use)\\s*\\(\\s*['"\`]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'i'),
    // FastAPI: @app.get("/api/users")
    new RegExp(`@(?:app|router)\\.(?:get|post|put|delete|patch)\\s*\\(\\s*['"]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'i'),
    // Flask: @app.route("/api/users")
    new RegExp(`@(?:app|blueprint)\\.route\\s*\\(\\s*['"]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'i'),
    // Partial match
    new RegExp(`['"\`]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'i'),
  ]

  const matchedFiles: Array<{ file: string; line: number; context: string }> = []

  for (const [filePath, content] of fileContents) {
    const relPath = path.relative(absPath, filePath)
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of routePatterns) {
        if (pattern.test(lines[i])) {
          matchedFiles.push({ file: relPath, line: i + 1, context: lines[i].trim().substring(0, 150) })
          break
        }
      }
    }
  }

  // For each match, find the handler entity and trace its call chain
  const chains: Array<{
    routeFile: string
    routeLine: number
    handler: string
    chain: Array<{ name: string; type: string; file: string; line: number }>
  }> = []

  for (const match of matchedFiles.slice(0, 5)) {
    // Find the nearest entity at this location
    const handler = graph.entities.find(e =>
      e.filePath.replace(/\\/g, '/') === match.file.replace(/\\/g, '/') &&
      e.line <= match.line && e.endLine >= match.line && e.type !== 'File'
    ) || graph.entities.find(e =>
      e.filePath.replace(/\\/g, '/') === match.file.replace(/\\/g, '/') &&
      Math.abs(e.line - match.line) < 10 && e.type !== 'File'
    )

    if (!handler) continue

    // BFS forward through calls to trace the full chain
    const chain: Array<{ name: string; type: string; file: string; line: number }> = [
      { name: handler.name, type: handler.type, file: handler.filePath, line: handler.line },
    ]
    const visited = new Set([handler.id])
    const queue = [{ id: handler.id, d: 0 }]

    while (queue.length > 0) {
      const cur = queue.shift()!
      if (cur.d >= depth) continue
      for (const r of graph.relations) {
        if (r.type === 'calls' && r.source === cur.id && !visited.has(r.target)) {
          visited.add(r.target)
          const callee = graph.entities.find(e => e.id === r.target)
          if (callee) {
            chain.push({ name: callee.name, type: callee.type, file: callee.filePath, line: callee.line })
            queue.push({ id: callee.id, d: cur.d + 1 })
          }
        }
      }
    }

    chains.push({
      routeFile: match.file,
      routeLine: match.line,
      handler: handler.name,
      chain,
    })
  }

  output({
    command: 'trace-route',
    route: routePath,
    matchedFiles: matchedFiles.length,
    chains,
    ...(matchedFiles.length === 0 ? { message: 'No route handlers found matching this path' } : {}),
  })
}

// ---- Batch Operations ----

function cmdBatch(subCmd: string, entityNames: string[], projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const docs = buildSearchDocs(fileContents, absPath)

  const results: Array<{ entity: string; result: unknown }> = []

  for (const name of entityNames) {
    const entity = graph.entities.find(e =>
      e.name.toLowerCase() === name.toLowerCase()
    )

    if (!entity) {
      results.push({ entity: name, result: { error: `Entity not found: ${name}` } })
      continue
    }

    switch (subCmd) {
      case 'pre-check': {
        const rels = graph.relations.filter(r => r.source === entity.id || r.target === entity.id)
        const impacted = getImpactedEntities(entity.id, graph, depth)
        const impactedEnts = graph.entities.filter(e => impacted.has(e.id) && e.id !== entity.id)
        const impactedFiles = [...new Set(impactedEnts.map(e => e.filePath))]
        const warnings: string[] = []
        if (impactedEnts.length > 20) warnings.push(`High impact: ${impactedEnts.length} entities affected`)
        if (impactedFiles.length > 8) warnings.push(`Wide impact: ${impactedFiles.length} files affected`)
        const risk = warnings.length === 0 ? 'LOW' : warnings.length <= 2 ? 'MEDIUM' : 'HIGH'
        results.push({
          entity: name,
          result: {
            name: entity.name,
            type: entity.type,
            file: entity.filePath,
            line: entity.line,
            relations: rels.length,
            impactedEntities: impactedEnts.length,
            impactedFiles: impactedFiles.length,
            risk,
            warnings,
          },
        })
        break
      }
      case 'impact': {
        const impacted = getImpactedEntities(entity.id, graph, depth)
        const impactedEnts = graph.entities.filter(e => impacted.has(e.id) && e.id !== entity.id)
        const byFile = new Map<string, typeof impactedEnts>()
        for (const e of impactedEnts) { const l = byFile.get(e.filePath) || []; l.push(e); byFile.set(e.filePath, l) }
        results.push({
          entity: name,
          result: {
            totalEntities: impactedEnts.length,
            totalFiles: byFile.size,
            files: Array.from(byFile.entries()).map(([f, ents]) => ({
              file: f,
              entities: ents.map(e => ({ name: e.name, type: e.type, line: e.line })),
            })),
          },
        })
        break
      }
      case 'relations': {
        const outgoing = graph.relations
          .filter(r => r.source === entity.id)
          .map(r => {
            const target = graph.entities.find(e => e.id === r.target)
            return { type: r.type, target: target?.name || r.target, targetType: target?.type }
          })
        const incoming = graph.relations
          .filter(r => r.target === entity.id)
          .map(r => {
            const source = graph.entities.find(e => e.id === r.source)
            return { type: r.type, source: source?.name || r.source, sourceType: source?.type }
          })
        results.push({
          entity: name,
          result: { outgoing, incoming, total: outgoing.length + incoming.length },
        })
        break
      }
      default:
        results.push({ entity: name, result: { error: `Unknown batch subcommand: ${subCmd}` } })
    }
  }

  output({ command: 'batch', subCommand: subCmd, totalEntities: entityNames.length, results })
}

// ---- Wiki Export ----

function cmdExport(format: string, outputPath: string | undefined, projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const projectName = path.basename(absPath)

  let content: string
  let ext: string

  switch (format) {
    case 'markdown':
    case 'md': {
      ext = '.md'
      const sections: string[] = [
        `# ${projectName} — CodeWiki Export\n`,
        `Generated: ${new Date().toISOString()}\n`,
        `## Project Statistics\n`,
        `- **Entities**: ${graph.entities.length}`,
        `- **Relations**: ${graph.relations.length}`,
        `- **Files**: ${graph.entities.filter(e => e.type === 'File').length}\n`,
        `## Entity Summary\n`,
      ]

      // Group by type
      const byType = new Map<string, typeof graph.entities>()
      for (const e of graph.entities) {
        if (e.type === 'File') continue
        const list = byType.get(e.type) || []
        list.push(e)
        byType.set(e.type, list)
      }

      for (const [type, entities] of byType.entries()) {
        sections.push(`### ${type}s (${entities.length})\n`)
        sections.push('| Name | File | Line |')
        sections.push('|------|------|------|')
        for (const e of entities.slice(0, 50)) {
          sections.push(`| ${e.name} | ${e.filePath} | ${e.line} |`)
        }
        if (entities.length > 50) sections.push(`\n_...and ${entities.length - 50} more_\n`)
        sections.push('')
      }

      // Relations summary
      sections.push(`## Relations\n`)
      const relTypes = new Map<string, number>()
      for (const r of graph.relations) { relTypes.set(r.type, (relTypes.get(r.type) || 0) + 1) }
      for (const [type, count] of relTypes.entries()) {
        sections.push(`- **${type}**: ${count}`)
      }

      content = sections.join('\n')
      break
    }

    case 'html': {
      ext = '.html'
      const classes = graph.entities.filter(e => e.type === 'Class')
      const funcs = graph.entities.filter(e => e.type === 'Function')
      content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${projectName} — CodeWiki</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #0d1117; color: #e6edf3; }
    h1 { border-bottom: 1px solid #30363d; padding-bottom: 8px; }
    h2 { color: #58a6ff; margin-top: 32px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #30363d; padding: 6px 12px; text-align: left; font-size: 13px; }
    th { background: #161b22; }
    .stat { display: inline-block; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 20px; margin: 4px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #58a6ff; }
    .stat-label { font-size: 11px; color: #8b949e; }
  </style>
</head>
<body>
  <h1>${projectName}</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  <div>
    <div class="stat"><div class="stat-value">${graph.entities.length}</div><div class="stat-label">Entities</div></div>
    <div class="stat"><div class="stat-value">${graph.relations.length}</div><div class="stat-label">Relations</div></div>
    <div class="stat"><div class="stat-value">${graph.entities.filter(e => e.type === 'File').length}</div><div class="stat-label">Files</div></div>
  </div>
  <h2>Classes (${classes.length})</h2>
  <table><tr><th>Name</th><th>File</th><th>Line</th></tr>
  ${classes.map(e => `<tr><td>${e.name}</td><td>${e.filePath}</td><td>${e.line}</td></tr>`).join('\n  ')}
  </table>
  <h2>Functions (${funcs.length})</h2>
  <table><tr><th>Name</th><th>File</th><th>Line</th></tr>
  ${funcs.slice(0, 100).map(e => `<tr><td>${e.name}</td><td>${e.filePath}</td><td>${e.line}</td></tr>`).join('\n  ')}
  </table>
</body>
</html>`
      break
    }

    case 'json': {
      ext = '.json'
      content = JSON.stringify({
        project: projectName,
        generated: new Date().toISOString(),
        entities: graph.entities,
        relations: graph.relations,
        stats: {
          totalEntities: graph.entities.length,
          totalRelations: graph.relations.length,
          files: graph.entities.filter(e => e.type === 'File').length,
        },
      }, null, 2)
      break
    }

    default:
      output({ command: 'export', success: false, error: `Unknown format: ${format}. Use: markdown, html, json` })
      return
  }

  const outFile = outputPath || path.join(absPath, `codewiki-export${ext}`)
  const absOut = path.resolve(outFile)
  fs.writeFileSync(absOut, content, 'utf-8')
  output({ command: 'export', success: true, format, outputPath: absOut, size: content.length })
}

// ---- Wiki Quality Validation (structural alignment with industry-standard code wikis) ----

interface WikiCheckRule {
  id: string
  label: string
  weight: number
  test: (md: string) => { pass: boolean; detail: string }
}

// The reference structural conventions a high-quality code wiki page should follow.
// These mirror the layout used by leading hosted code-wiki tools so generated
// output can be validated/compared without exposing any third-party branding.
const WIKI_CHECK_RULES: WikiCheckRule[] = [
  {
    id: 'title',
    label: 'Page has a top-level H1 title',
    weight: 1,
    test: (md) => {
      const has = /^#\s+\S+/m.test(md)
      return { pass: has, detail: has ? 'H1 title found' : 'Missing "# Title" heading' }
    },
  },
  {
    id: 'relevant-sources',
    label: '"Relevant source files" section present',
    weight: 2,
    test: (md) => {
      const has = /relevant source files/i.test(md)
      return { pass: has, detail: has ? 'Relevant source files listed' : 'Missing "Relevant source files" section' }
    },
  },
  {
    id: 'purpose-scope',
    label: '"Purpose and Scope" intro section',
    weight: 2,
    test: (md) => {
      const has = /##\s+purpose\s+and\s+scope/i.test(md)
      return { pass: has, detail: has ? 'Purpose and Scope present' : 'Missing "## Purpose and Scope"' }
    },
  },
  {
    id: 'mermaid',
    label: 'At least one Mermaid diagram',
    weight: 2,
    test: (md) => {
      const count = (md.match(/```mermaid/g) || []).length
      return { pass: count >= 1, detail: count >= 1 ? `${count} Mermaid diagram(s)` : 'No Mermaid diagrams' }
    },
  },
  {
    id: 'tables',
    label: 'Component/summary table(s)',
    weight: 2,
    test: (md) => {
      const has = /\|\s*-+\s*\|/.test(md) || /\|.+\|.+\|/.test(md)
      return { pass: has, detail: has ? 'Markdown table(s) found' : 'No component/summary tables' }
    },
  },
  {
    id: 'sources',
    label: '"Sources:" citations with file references',
    weight: 3,
    test: (md) => {
      const count = (md.match(/sources:/gi) || []).length
      return { pass: count >= 1, detail: count >= 1 ? `${count} "Sources:" citation block(s)` : 'No "Sources:" citations' }
    },
  },
  {
    id: 'line-citations',
    label: 'File:line citations (e.g. file.ts#L10-L50)',
    weight: 2,
    test: (md) => {
      const count = (md.match(/#L\d+(-L?\d+)?/g) || []).length
      return { pass: count >= 1, detail: count >= 1 ? `${count} line-level citation(s)` : 'No file#Lxx-Lyy line citations' }
    },
  },
  {
    id: 'related-pages',
    label: 'Cross-page links / Related Pages',
    weight: 1,
    test: (md) => {
      const has = /##\s+related\s+pages/i.test(md) || /\]\([^)]*\.md[^)]*\)/.test(md) || /\[[^\]]+\]\(#[^)]+\)/.test(md)
      return { pass: has, detail: has ? 'Related/cross links present' : 'No related-page cross links' }
    },
  },
]

function scoreWikiMarkdown(md: string): {
  score: number
  maxScore: number
  percent: number
  results: Array<{ id: string; label: string; pass: boolean; weight: number; detail: string }>
} {
  let score = 0
  let maxScore = 0
  const results = WIKI_CHECK_RULES.map((rule) => {
    const r = rule.test(md)
    maxScore += rule.weight
    if (r.pass) score += rule.weight
    return { id: rule.id, label: rule.label, pass: r.pass, weight: rule.weight, detail: r.detail }
  })
  return { score, maxScore, percent: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0, results }
}

// Split a multi-page wiki markdown (export or single page) into individual pages by H1.
function splitWikiPages(md: string): Array<{ title: string; content: string }> {
  const lines = md.split(/\r?\n/)
  const pages: Array<{ title: string; content: string }> = []
  let current: { title: string; content: string } | null = null
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)$/)
    if (m) {
      if (current) pages.push(current)
      current = { title: m[1].trim(), content: line + '\n' }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current) pages.push(current)
  return pages.length > 0 ? pages : [{ title: 'Wiki', content: md }]
}

function cmdWikiCheck(target: string): void {
  const absTarget = path.resolve(target)
  if (!fs.existsSync(absTarget)) {
    output({ command: 'wiki-check', success: false, error: `File not found: ${absTarget}` })
    process.exit(1)
  }

  // Collect markdown files: either a single .md file or all .md in a directory
  const mdFiles: string[] = []
  const stat = fs.statSync(absTarget)
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(absTarget)) {
      if (f.toLowerCase().endsWith('.md')) mdFiles.push(path.join(absTarget, f))
    }
  } else {
    mdFiles.push(absTarget)
  }

  if (mdFiles.length === 0) {
    output({ command: 'wiki-check', success: false, error: 'No .md files found to validate' })
    process.exit(1)
  }

  const pageReports: Array<{ file: string; title: string; percent: number; score: number; maxScore: number; results: any[] }> = []
  for (const file of mdFiles) {
    const md = fs.readFileSync(file, 'utf-8')
    const pages = splitWikiPages(md)
    for (const page of pages) {
      const s = scoreWikiMarkdown(page.content)
      pageReports.push({
        file: path.relative(process.cwd(), file),
        title: page.title,
        percent: s.percent,
        score: s.score,
        maxScore: s.maxScore,
        results: s.results,
      })
    }
  }

  const overallPercent = Math.round(pageReports.reduce((sum, p) => sum + p.percent, 0) / pageReports.length)
  const grade = overallPercent >= 90 ? 'A (aligned)' : overallPercent >= 75 ? 'B (mostly aligned)' : overallPercent >= 50 ? 'C (partial)' : 'D (needs work)'

  if (isJson) {
    output({
      command: 'wiki-check',
      success: true,
      overallPercent,
      grade,
      pageCount: pageReports.length,
      pages: pageReports,
    })
    return
  }

  console.log(`\n  Wiki Structure Validation — alignment with code-wiki conventions`)
  console.log('  ' + '─'.repeat(60))
  for (const p of pageReports) {
    const bar = '█'.repeat(Math.round(p.percent / 10)) + '░'.repeat(10 - Math.round(p.percent / 10))
    console.log(`\n  ${p.title}  [${bar}] ${p.percent}%  (${p.score}/${p.maxScore})`)
    for (const r of p.results) {
      console.log(`    ${r.pass ? '✓' : '✗'} ${r.label} — ${r.detail}`)
    }
  }
  console.log('\n  ' + '─'.repeat(60))
  console.log(`  Overall alignment: ${overallPercent}%  Grade: ${grade}`)
  console.log(`  Pages checked: ${pageReports.length}\n`)
}

// ---- Wiki Prompt Template Management ----
// Self-contained registry mirrored from src/services/wiki-prompt-templates.ts.
// The standalone CLI binary must not import outside its rootDir, so the
// reverse-engineered styles are duplicated here intentionally.

interface CliWikiTemplate {
  id: string
  label: string
  description: string
  inspiration: string
  systemPrompt: string
  guidance: Record<string, string>
}

const WIKI_CLI_TEMPLATES: Record<string, CliWikiTemplate> = {
  hierarchical: {
    id: 'hierarchical',
    label: '分层导览（结构化）',
    description: 'Hierarchical numbered pages, relevant-source lists, Mermaid diagrams, component tables, line-level Sources citations, cross-page links.',
    inspiration: 'DeepWiki-style hierarchical numbered wiki',
    systemPrompt: `You are a senior technical documentation expert generating wiki pages for a code knowledge base.

Output rules:
- Write clear, authoritative technical documentation in Markdown
- Start with a "## Purpose and Scope" section explaining what this page covers
- After the intro, add a "## Related Pages" section with bullet links to related sections
- Use Mermaid diagrams (\`\`\`mermaid code blocks) for architecture, component relationships, data flow
- Include component/module summary tables (columns: Component | File | Key Exports | Purpose)
- Reference specific source files with line numbers like: [lib/app.js#L27-L56]
- At the end of each major section, add a "Sources:" line listing all referenced files
- Structure content with clear headings (##, ###)
- Keep a professional, concise tone — avoid filler text`,
    guidance: {
      default: 'Follow hierarchical wiki conventions: Purpose and Scope, diagrams, tables, line-level Sources citations, Related Pages links.',
    },
  },
  engineering: {
    id: 'engineering',
    label: '工程详解（设计文档）',
    description: 'Emphasizes design rationale, contracts/invariants, sequence/class diagrams, trade-offs and edge cases. Deep and precise.',
    inspiration: 'Google-style engineering design doc / codewiki',
    systemPrompt: `You are a principal software engineer writing an internal engineering design document for a codebase, in the rigorous style of a large engineering organization's design reviews.

Output rules:
- Write precise, unambiguous Markdown using exact terminology from the code
- Begin with a "## Overview" giving a one-paragraph problem statement and the component's responsibility
- Add a "## Design" section explaining WHY the code is structured this way — invariants, contracts, data model
- Use Mermaid sequence diagrams for control/data flow and class diagrams for type relationships
- Document public API contracts in tables (Symbol | Signature | Preconditions | Postconditions | File)
- Include a "## Trade-offs and Alternatives" section
- Include a "## Edge Cases and Failure Modes" section
- Reference source files with line numbers like [file.ts#L10-L50]
- End each major section with a "Sources:" line
- Be thorough and technically deep`,
    guidance: {
      default: 'Emphasize design rationale, contracts/invariants, trade-offs, and edge cases. Use sequence/class diagrams and contract tables. Cite line-level Sources.',
      api: 'Document each public symbol as a contract: signature, preconditions, postconditions, errors, side effects.',
    },
  },
  concise: {
    id: 'concise',
    label: '速读概览（精炼）',
    description: 'Fast-reading: one-line TL;DR + key-point bullets, minimal diagrams, short tables. Optimized for quick scanning.',
    inspiration: 'zread-style fast-reading summary',
    systemPrompt: `You are a developer-advocate writing fast, scannable code documentation optimized for quick reading and onboarding.

Output rules:
- Write concise, high-signal Markdown — every line must earn its place
- Begin with a "## TL;DR" of 1-2 sentences summarizing the page
- Follow with a "## Key Points" bulleted list (3-6 bullets)
- Use at most ONE Mermaid diagram per page, only when it genuinely aids understanding
- Prefer short tables (Item | What it does) over long prose
- Reference source files with line numbers like [file.ts#L10-L50] inline and minimal
- End the page with a single "Sources:" line
- Avoid repetition, hedging, and filler`,
    guidance: {
      default: 'Lead with a TL;DR and Key Points. Stay concise and scannable. Use at most one diagram and short tables. Single Sources line at end.',
    },
  },
}

function getCliTemplate(style?: string): CliWikiTemplate {
  if (style && WIKI_CLI_TEMPLATES[style]) return WIKI_CLI_TEMPLATES[style]
  return WIKI_CLI_TEMPLATES.hierarchical
}

function cmdWikiStyles(sub: string | undefined, id: string | undefined): void {
  const list = Object.values(WIKI_CLI_TEMPLATES)
  if (sub === 'show') {
    const tpl = id ? WIKI_CLI_TEMPLATES[id] : undefined
    if (!tpl) {
      output({ command: 'wiki-styles', success: false, error: `Unknown style: ${id}. Available: ${list.map(t => t.id).join(', ')}` })
      process.exit(1)
    }
    if (isJson) { output({ command: 'wiki-styles', success: true, template: tpl }); return }
    console.log(`\n  ${tpl.label}  (id: ${tpl.id})`)
    console.log('  ' + '─'.repeat(60))
    console.log(`  ${tpl.description}\n`)
    console.log('  System prompt:')
    console.log(tpl.systemPrompt.split('\n').map(l => '    ' + l).join('\n'))
    console.log('')
    return
  }
  if (isJson) {
    output({ command: 'wiki-styles', success: true, styles: list.map(t => ({ id: t.id, label: t.label, description: t.description })) })
    return
  }
  console.log(`\n  Wiki prompt styles (${list.length})`)
  console.log('  ' + '─'.repeat(60))
  for (const t of list) {
    console.log(`\n  ${t.id}  —  ${t.label}`)
    console.log(`    ${t.description}`)
  }
  console.log(`\n  Use: codewiki wiki-styles show <id>   |   codewiki wiki-generate --style <id>\n`)
}

// ---- LLM-backed Wiki Generation (CLI) ----

function llmChat(
  messages: Array<{ role: string; content: string }>,
  opts: { provider: string; model: string; apiKey: string; baseUrl: string; temperature: number; maxTokens: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const urlMod = require('url')
    const u = new urlMod.URL(opts.baseUrl.replace(/\/$/, '') + '/chat/completions')
    const body = JSON.stringify({
      model: opts.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: false,
    })
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: u.port || 443,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res: any) => {
        let data = ''
        res.on('data', (c: any) => (data += c))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)))
            const content = parsed.choices?.[0]?.message?.content
            if (typeof content !== 'string') return reject(new Error('No content in LLM response: ' + data.slice(0, 200)))
            resolve(content)
          } catch (e) {
            reject(new Error('Failed to parse LLM response: ' + data.slice(0, 200)))
          }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function prettifyModuleName(raw: string): string {
  const clean = raw.replace(/[-_]/g, ' ').trim()
  return clean.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function detectCliModules(graph: OntologyGraph): Array<{ name: string; entities: typeof graph.entities }> {
  const dirMap = new Map<string, typeof graph.entities>()
  for (const e of graph.entities) {
    if (e.type === 'File') continue
    const dir = e.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    const list = dirMap.get(dir) || []
    list.push(e)
    dirMap.set(dir, list)
  }
  const dirs = [...dirMap.keys()]
  const hasSubdirs = dirs.some(d => d && d !== '.')
  const mods: Array<{ name: string; entities: typeof graph.entities }> = []

  if (hasSubdirs) {
    // Detect base-name collisions so we can disambiguate with the parent dir
    const baseCount = new Map<string, number>()
    for (const dir of dirs) {
      const parts = dir.split('/').filter(p => p && p !== '.')
      if (parts.length === 0) continue
      const base = parts[parts.length - 1].toLowerCase()
      baseCount.set(base, (baseCount.get(base) || 0) + 1)
    }
    for (const [dir, ents] of dirMap) {
      if (ents.length < 2) continue
      const parts = dir.split('/').filter(p => p && p !== '.')
      if (parts.length === 0) continue
      const base = parts[parts.length - 1]
      const collides = (baseCount.get(base.toLowerCase()) || 0) > 1
      const label = collides && parts.length > 1 ? `${parts[parts.length - 2]}/${base}` : base
      mods.push({ name: prettifyModuleName(label), entities: ents })
    }
  } else {
    // Flat repo: group entities by source file so we still get useful sub-pages
    const fileMap = new Map<string, typeof graph.entities>()
    for (const e of graph.entities) {
      if (e.type === 'File') continue
      const f = e.filePath
      const list = fileMap.get(f) || []
      list.push(e)
      fileMap.set(f, list)
    }
    for (const [file, ents] of fileMap) {
      if (ents.length < 2) continue
      const norm = file.replace(/\\/g, '/')
      const base = (norm.split('/').pop() || norm).replace(/\.[^.]+$/, '')
      mods.push({ name: prettifyModuleName(base), entities: ents })
    }
  }
  mods.sort((a, b) => b.entities.length - a.entities.length)
  return mods.slice(0, 6)
}

function summarizeCliOntology(graph: OntologyGraph): string {
  const byType = new Map<string, number>()
  for (const e of graph.entities) byType.set(e.type, (byType.get(e.type) || 0) + 1)
  const counts = [...byType.entries()].map(([t, n]) => `${t}: ${n}`).join(', ')
  const top = graph.entities.filter(e => e.type !== 'File').slice(0, 40)
    .map(e => `- ${e.type} ${e.name} (${e.filePath}:${e.line || 0})`).join('\n')
  return `Entity counts: ${counts}\nKey entities:\n${top}`
}

async function cmdWikiGenerate(projectPath: string, opts: {
  style: string; provider: string; model: string; outDir: string
}): Promise<void> {
  const absPath = path.resolve(projectPath)
  const apiKey = process.env.CODEWIKI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || ''
  if (!apiKey) {
    output({ command: 'wiki-generate', success: false, error: 'No API key. Set CODEWIKI_API_KEY (or DEEPSEEK_API_KEY / OPENAI_API_KEY) in the environment.' })
    process.exit(1)
  }
  const baseUrlMap: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai: 'https://api.openai.com/v1',
  }
  const baseUrl = process.env.CODEWIKI_BASE_URL || baseUrlMap[opts.provider] || baseUrlMap.deepseek
  const tpl = getCliTemplate(opts.style)
  const { graph } = getGraph(absPath)
  const modules = detectCliModules(graph)
  const ontologySummary = summarizeCliOntology(graph)
  const fileList = [...new Set(graph.entities.map(e => e.filePath))].filter(Boolean).slice(0, 120).join('\n')

  const llmOpts = { provider: opts.provider, model: opts.model, apiKey, baseUrl, temperature: 0.3, maxTokens: 4000 }

  const allFiles = [...new Set(graph.entities.map(e => e.filePath.replace(/\\/g, '/')))].filter(Boolean)
  const filesFor = (ents: typeof graph.entities): string[] =>
    [...new Set(ents.map(e => e.filePath.replace(/\\/g, '/')))].filter(Boolean)

  const pagePlans: Array<{ title: string; slug: string; kind: string; prompt: string; files: string[] }> = [
    {
      title: 'Overview', slug: '1-overview', kind: 'overview', files: allFiles.slice(0, 12),
      prompt: `Generate a comprehensive Overview page for the project at ${path.basename(absPath)}.\n\nFile structure:\n${fileList.substring(0, 2500)}\n\nOntology summary:\n${ontologySummary}\n\nRequirements:\n1. "## Purpose and Scope"\n2. High-level architecture Mermaid diagram\n3. Component summary table (Component | File | Purpose)\n4. "## Repository Structure"\n5. End sections with "Sources:" lines`,
    },
    {
      title: 'Core Architecture', slug: '2-core-architecture', kind: 'architecture', files: allFiles.slice(0, 12),
      prompt: `Generate a Core Architecture page.\n\nOntology summary:\n${ontologySummary}\n\nRelations: imports=${graph.relations.filter(r => r.type === 'imports').length}, calls=${graph.relations.filter(r => r.type === 'calls').length}, extends=${graph.relations.filter(r => r.type === 'extends').length}, contains=${graph.relations.filter(r => r.type === 'contains').length}\n\nRequirements:\n1. "## Purpose and Scope"\n2. System architecture Mermaid diagram\n3. Component table (Component | File | Key Methods | Purpose)\n4. "## Design Patterns"\n5. Reference files with line numbers [file.ts#L10-L50]\n6. End sections with "Sources:"`,
    },
  ]
  modules.forEach((m, i) => {
    const ents = m.entities.slice(0, 25).map(e => `- ${e.type} ${e.name} (${e.filePath}:${e.line || 0})`).join('\n')
    pagePlans.push({
      title: m.name, slug: `2.${i + 1}-${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`, kind: 'module', files: filesFor(m.entities).slice(0, 12),
      prompt: `Generate detailed documentation for the "${m.name}" module.\n\nEntities:\n${ents}\n\nRequirements:\n1. "## Purpose and Scope"\n2. Component interaction Mermaid diagram\n3. Key classes/functions table (Name | File:Line | Purpose)\n4. "## Implementation Details"\n5. "## Integration Points"\n6. Reference files [file.ts#L10-L50]\n7. End sections with "Sources:"`,
    })
  })
  pagePlans.push({
    title: 'API Reference', slug: `${3 + modules.length}-api-reference`, kind: 'api', files: filesFor(graph.entities.filter(e => e.type === 'Class' || e.type === 'Interface' || e.type === 'Function' || e.type === 'Method')).slice(0, 12),
    prompt: `Generate an API Reference page.\n\nClasses/Interfaces:\n${graph.entities.filter(e => e.type === 'Class' || e.type === 'Interface').slice(0, 30).map(e => `- ${e.type} ${e.name} (${e.filePath}:${e.line || 0})`).join('\n')}\n\nFunctions/Methods:\n${graph.entities.filter(e => e.type === 'Function' || e.type === 'Method').slice(0, 40).map(e => `- ${e.name} (${e.filePath}:${e.line || 0})`).join('\n')}\n\nRequirements:\n1. "## Purpose and Scope"\n2. Class hierarchy Mermaid classDiagram\n3. API summary tables (Name | File:Line | Description)\n4. End sections with "Sources:"`,
  })

  const outDir = path.resolve(opts.outDir)
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  if (!isJson) console.log(`\n  Generating wiki (style: ${tpl.id}, model: ${opts.model}) → ${outDir}\n`)
  const generated: Array<{ title: string; file: string }> = []
  for (let i = 0; i < pagePlans.length; i++) {
    const p = pagePlans[i]
    if (!isJson) process.stdout.write(`  [${i + 1}/${pagePlans.length}] ${p.title} ... `)
    const guidance = tpl.guidance[p.kind] || tpl.guidance.default
    let content: string
    try {
      content = await llmChat(
        [
          { role: 'system', content: tpl.systemPrompt },
          { role: 'user', content: `${p.prompt}\n\nStyle guidance: ${guidance}` },
        ],
        llmOpts,
      )
    } catch (e) {
      if (!isJson) console.log('FAILED')
      output({ command: 'wiki-generate', success: false, error: `LLM call failed on "${p.title}": ${(e as Error).message}` })
      process.exit(1)
    }
    let body = content.trimStart()
    // Ensure a single top-level H1 title
    if (!/^#\s/.test(body)) body = `# ${p.title}\n\n${body}`
    // Inject "Relevant source files" block right after the H1 (DeepWiki convention)
    if (!/Relevant source files/i.test(body) && p.files.length) {
      const srcBlock = '**Relevant source files**\n\n' + p.files.map(f => `- [${f}](${f})`).join('\n') + '\n'
      body = body.replace(/^(#\s.*(?:\r?\n)+)/, `$1${srcBlock}\n`)
    }
    // Fallback "Sources:" citation if the LLM omitted one
    if (!/Sources:/i.test(body) && p.files.length) {
      body += `\n\nSources: ${p.files.slice(0, 6).map(f => `[${f}](${f})`).join(', ')}\n`
    }
    const md = body + '\n'
    const file = path.join(outDir, `${p.slug}.md`)
    fs.writeFileSync(file, md, 'utf-8')
    generated.push({ title: p.title, file: path.relative(process.cwd(), file) })
    if (!isJson) console.log('done')
  }

  if (isJson) {
    output({ command: 'wiki-generate', success: true, style: tpl.id, model: opts.model, outDir: path.relative(process.cwd(), outDir), pages: generated })
    return
  }
  console.log(`\n  ✓ Generated ${generated.length} pages into ${path.relative(process.cwd(), outDir)}`)
  console.log(`  Run: codewiki wiki-check ${path.relative(process.cwd(), outDir)}\n`)
}

// ---- File Watcher ----

function cmdWatch(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  console.log(`Watching for changes in: ${absPath}`)
  console.log('Press Ctrl+C to stop.\n')

  let { graph } = getGraph(absPath)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const reindex = () => {
    console.log(`[${new Date().toISOString()}] Re-indexing...`)
    const fresh = buildOntology(absPath)
    const oldCount = graph.entities.length
    graph = fresh.graph
    const diff = graph.entities.length - oldCount
    console.log(`  Entities: ${graph.entities.length} (${diff >= 0 ? '+' : ''}${diff}), Relations: ${graph.relations.length}`)
  }

  const watcher = fs.watch(absPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return
    // Skip non-code files and hidden/ignored dirs
    const parts = filename.split(path.sep)
    if (parts.some(p => p.startsWith('.') || IGNORED_DIRS.has(p))) return
    const ext = path.extname(filename).toLowerCase()
    if (!CODE_EXTENSIONS.has(ext)) return

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(reindex, 1000)
  })

  // Keep alive
  process.on('SIGINT', () => {
    watcher.close()
    console.log('\nWatch stopped.')
    process.exit(0)
  })
}

// ---- Architecture Overview ----

function cmdArchitecture(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)

  // Languages
  const langMap = new Map<string, number>()
  for (const e of graph.entities) {
    if (e.type !== 'File') continue
    const ext = path.extname(e.filePath).toLowerCase()
    const lang = { '.ts': 'TypeScript', '.tsx': 'TypeScript/React', '.js': 'JavaScript', '.jsx': 'JavaScript/React', '.py': 'Python', '.java': 'Java', '.rs': 'Rust', '.go': 'Go', '.cpp': 'C++', '.c': 'C', '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP' }[ext] || ext
    langMap.set(lang, (langMap.get(lang) || 0) + 1)
  }

  // Entry points (files with no incoming imports)
  const importedFiles = new Set<string>()
  for (const r of graph.relations) {
    if (r.type === 'imports') {
      const target = graph.entities.find(e => e.id === r.target)
      if (target) importedFiles.add(target.filePath)
    }
  }
  const entryPoints = graph.entities
    .filter(e => e.type === 'File' && !importedFiles.has(e.filePath))
    .map(e => e.filePath)

  // Hotspots (most depended-upon entities by incoming edges)
  const inDegree = new Map<string, number>()
  for (const r of graph.relations) {
    if (r.type !== 'contains') inDegree.set(r.target, (inDegree.get(r.target) || 0) + 1)
  }
  const hotspots = Array.from(inDegree.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => {
      const e = graph.entities.find(ent => ent.id === id)
      return e ? { name: e.name, type: e.type, file: e.filePath, inDegree: count } : null
    })
    .filter(Boolean)

  // Layers (group by directory)
  const layers = new Map<string, number>()
  for (const e of graph.entities) {
    if (e.type === 'File') continue
    const dir = path.dirname(e.filePath) || '.'
    layers.set(dir, (layers.get(dir) || 0) + 1)
  }

  // Boundaries (cross-directory dependencies)
  const crossDeps: Array<{ from: string; to: string; count: number }> = []
  const crossMap = new Map<string, number>()
  for (const r of graph.relations) {
    if (r.type === 'contains') continue
    const src = graph.entities.find(e => e.id === r.source)
    const tgt = graph.entities.find(e => e.id === r.target)
    if (!src || !tgt) continue
    const fromDir = path.dirname(src.filePath) || '.'
    const toDir = path.dirname(tgt.filePath) || '.'
    if (fromDir !== toDir) {
      const key = `${fromDir}→${toDir}`
      crossMap.set(key, (crossMap.get(key) || 0) + 1)
    }
  }
  for (const [key, count] of crossMap) {
    const [from, to] = key.split('→')
    crossDeps.push({ from, to, count })
  }
  crossDeps.sort((a, b) => b.count - a.count)

  output({
    command: 'architecture',
    summary: {
      totalEntities: graph.entities.filter(e => e.type !== 'File').length,
      totalRelations: graph.relations.length,
      totalFiles: graph.entities.filter(e => e.type === 'File').length,
    },
    languages: Array.from(langMap.entries()).sort((a, b) => b[1] - a[1]).map(([lang, count]) => ({ language: lang, files: count })),
    entryPoints: entryPoints.slice(0, 20),
    hotspots,
    layers: Array.from(layers.entries()).sort((a, b) => b[1] - a[1]).map(([dir, count]) => ({ directory: dir, entities: count })),
    boundaries: crossDeps.slice(0, 15),
  })
}

// ---- Git Diff Impact ----

function cmdGitDiffImpact(projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)

  // Run git diff to get changed files. With `--base <ref>` (e.g. a PR base
  // branch) we diff <base>...HEAD; otherwise we use the working tree + stage.
  const baseIdx = process.argv.indexOf('--base')
  const baseRef = baseIdx !== -1 ? process.argv[baseIdx + 1] : undefined
  let diffOutput = ''
  try {
    const { execSync } = require('child_process')
    if (baseRef) {
      diffOutput = execSync(`git diff --name-only ${baseRef}...HEAD`, { cwd: absPath, encoding: 'utf-8' })
    } else {
      diffOutput = execSync('git diff --name-only', { cwd: absPath, encoding: 'utf-8' })
      const stagedOutput = execSync('git diff --staged --name-only', { cwd: absPath, encoding: 'utf-8' })
      const allFiles = new Set([...diffOutput.trim().split('\n'), ...stagedOutput.trim().split('\n')].filter(Boolean))
      diffOutput = Array.from(allFiles).join('\n')
    }
  } catch {
    output({ command: 'git-diff', error: 'Not a git repository or git not available' })
    return
  }

  const changedFiles = diffOutput.trim().split('\n').filter(Boolean)
  if (changedFiles.length === 0) {
    output({ command: 'git-diff', changedFiles: [], affectedSymbols: [], riskSummary: { low: 0, medium: 0, high: 0, critical: 0 } })
    return
  }

  // Map changed files to affected entities
  const affectedSymbols: Array<{ name: string; type: string; file: string; risk: string; dependentCount: number }> = []
  const riskSummary = { low: 0, medium: 0, high: 0, critical: 0 }

  for (const file of changedFiles) {
    const fileEntities = graph.entities.filter(e => e.filePath === file || e.filePath.endsWith(file))
    for (const entity of fileEntities) {
      if (entity.type === 'File') continue
      // Compute blast radius for each
      const seeds = [entity.id]
      for (const r of graph.relations) {
        if (r.source === entity.id && r.type === 'contains') seeds.push(r.target)
      }
      const dependents = new Set<string>()
      const queue = seeds.map(id => ({ id, d: 0 }))
      while (queue.length > 0) {
        const cur = queue.shift()!
        if (cur.d > depth || dependents.has(cur.id)) continue
        dependents.add(cur.id)
        for (const r of graph.relations) {
          if (r.target === cur.id && !dependents.has(r.source) && r.type !== 'contains') {
            queue.push({ id: r.source, d: cur.d + 1 })
          }
        }
      }
      for (const s of seeds) dependents.delete(s)

      let risk = 'low'
      if (dependents.size > 30) risk = 'critical'
      else if (dependents.size > 15) risk = 'high'
      else if (dependents.size > 5) risk = 'medium'

      riskSummary[risk as keyof typeof riskSummary]++
      affectedSymbols.push({ name: entity.name, type: entity.type, file: entity.filePath, risk, dependentCount: dependents.size })
    }
  }

  affectedSymbols.sort((a, b) => b.dependentCount - a.dependentCount)

  output({
    command: 'git-diff',
    changedFiles,
    affectedSymbols,
    riskSummary,
    overallRisk: riskSummary.critical > 0 ? 'critical' : riskSummary.high > 0 ? 'high' : riskSummary.medium > 0 ? 'medium' : 'low',
  })
}

// ---- Community Detection (Louvain-inspired clustering) ----

function cmdCommunityDetect(projectPath: string): void {
  const absPath = path.resolve(projectPath)
  const { graph } = getGraph(absPath)

  // Build adjacency by non-contains relations
  const entityIds = graph.entities.filter(e => e.type !== 'File').map(e => e.id)
  const idSet = new Set(entityIds)
  const adj = new Map<string, Set<string>>()
  for (const id of entityIds) adj.set(id, new Set())
  for (const r of graph.relations) {
    if (r.type === 'contains') continue
    if (idSet.has(r.source) && idSet.has(r.target)) {
      adj.get(r.source)!.add(r.target)
      adj.get(r.target)!.add(r.source)
    }
  }

  // Simple connected-components + file-based clustering
  const visited = new Set<string>()
  const clusters: Array<{ id: number; entities: string[]; files: Set<string>; cohesion: number }> = []
  let clusterId = 0

  for (const startId of entityIds) {
    if (visited.has(startId)) continue
    // BFS connected component
    const component: string[] = []
    const q = [startId]
    visited.add(startId)
    while (q.length > 0) {
      const cur = q.shift()!
      component.push(cur)
      for (const neighbor of adj.get(cur) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          q.push(neighbor)
        }
      }
    }

    const files = new Set<string>()
    for (const id of component) {
      const e = graph.entities.find(ent => ent.id === id)
      if (e) files.add(e.filePath)
    }

    // Cohesion = internal edges / max possible edges
    let internalEdges = 0
    for (const id of component) {
      for (const neighbor of adj.get(id) || []) {
        if (component.includes(neighbor)) internalEdges++
      }
    }
    internalEdges /= 2 // undirected
    const maxEdges = component.length * (component.length - 1) / 2
    const cohesion = maxEdges > 0 ? Math.round(internalEdges / maxEdges * 100) / 100 : 1

    clusters.push({ id: clusterId++, entities: component, files, cohesion })
  }

  // Sort by size
  clusters.sort((a, b) => b.entities.length - a.entities.length)

  output({
    command: 'community',
    totalClusters: clusters.length,
    clusters: clusters.slice(0, 20).map(c => ({
      id: c.id,
      size: c.entities.length,
      files: Array.from(c.files),
      cohesion: c.cohesion,
      members: c.entities.slice(0, 10).map(id => {
        const e = graph.entities.find(ent => ent.id === id)
        return e ? { name: e.name, type: e.type } : null
      }).filter(Boolean),
    })),
  })
}

// ---- Suggest Tests ----

function cmdSuggestTests(entityName: string, projectPath: string, depth: number): void {
  const absPath = path.resolve(projectPath)
  const { graph, fileContents } = getGraph(absPath)
  const entity = findEntity(graph, entityName)
  if (!entity) { output({ command: 'suggest-tests', error: `Entity "${entityName}" not found` }); return }

  // Find test files
  const testFiles: Array<{ file: string; relevance: string; reason: string }> = []
  for (const [file, content] of Object.entries(fileContents)) {
    const lc = content.toLowerCase()
    const fn = file.toLowerCase()
    const isTestFile = fn.includes('test') || fn.includes('spec') || fn.includes('__tests__')
    if (!isTestFile) continue

    // Check if the test file references this entity
    if (lc.includes(entity.name.toLowerCase())) {
      testFiles.push({ file, relevance: 'direct', reason: `References ${entity.name}` })
      continue
    }

    // Check if it references any entity that depends on this one
    const seeds = [entity.id]
    for (const r of graph.relations) {
      if (r.source === entity.id && r.type === 'contains') seeds.push(r.target)
    }
    const dependents = new Set<string>()
    const queue = seeds.map(id => ({ id, d: 0 }))
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (cur.d > depth || dependents.has(cur.id)) continue
      dependents.add(cur.id)
      for (const r of graph.relations) {
        if (r.target === cur.id && !dependents.has(r.source) && r.type !== 'contains') {
          queue.push({ id: r.source, d: cur.d + 1 })
        }
      }
    }
    for (const s of seeds) dependents.delete(s)

    for (const depId of dependents) {
      const dep = graph.entities.find(e => e.id === depId)
      if (dep && lc.includes(dep.name.toLowerCase())) {
        testFiles.push({ file, relevance: 'indirect', reason: `Tests ${dep.name} which depends on ${entity.name}` })
        break
      }
    }
  }

  output({
    command: 'suggest-tests',
    entity: { name: entity.name, type: entity.type, file: entity.filePath },
    suggestedTests: testFiles,
    totalTestFiles: testFiles.length,
  })
}

// ---- CodeWiki Server (HTTP API + Call Logging + Dashboard) ----

interface CallLogEntry {
  id: string
  timestamp: string
  source: 'cli' | 'mcp' | 'api'
  command: string
  args: Record<string, unknown>
  result: Record<string, unknown> | null
  duration: number
  accuracy?: number
  status: 'success' | 'error'
}

const callLog: CallLogEntry[] = []
let serverProjectPath = ''

function generateCallId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ---- Shared on-disk call log (so CLI / MCP / server processes share one trace) ----

function callLogDir(): string {
  return process.env.CODEWIKI_LOG_DIR || path.join(os.homedir(), '.codewiki')
}
function callLogFile(): string {
  return path.join(callLogDir(), 'call-log.jsonl')
}

function appendCallLogDisk(entry: CallLogEntry): void {
  try {
    fs.mkdirSync(callLogDir(), { recursive: true })
    fs.appendFileSync(callLogFile(), JSON.stringify(entry) + '\n', 'utf-8')
  } catch { /* logging must never break a command */ }
}

function readCallLogDisk(limit = 10000): CallLogEntry[] {
  try {
    const raw = fs.readFileSync(callLogFile(), 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const slice = limit > 0 ? lines.slice(-limit) : lines
    const out: CallLogEntry[] = []
    for (const l of slice) {
      try { out.push(JSON.parse(l) as CallLogEntry) } catch { /* skip corrupt line */ }
    }
    return out
  } catch { return [] }
}

function scoreAccuracy(command: string, result: Record<string, unknown>): number {
  if (!result || result.error) return 0

  switch (command) {
    case 'blast-radius': {
      const count = (result.dependentCount as number) || 0
      const risk = result.risk as string
      if (count === 0 && risk === 'low') return 0.3 // suspicious
      if (count > 0 && risk !== 'low') return 0.95
      return 0.7
    }
    case 'callers':
    case 'callees': {
      const items = (result.callers || result.callees || []) as unknown[]
      return items.length > 0 ? 0.9 : 0.5
    }
    case 'impact': {
      const count = (result.impactedCount as number) ?? ((result.affectedEntities as unknown[]) || []).length
      return count > 0 ? 0.85 : 0.5
    }
    case 'pre-check': {
      return (result.target || result.entity) ? 0.9 : 0.3
    }
    case 'verify': {
      const warns = (result.warnings as unknown[]) || []
      return warns.length === 0 ? 0.9 : 0.7
    }
    case 'search': {
      const results = (result.results as unknown[]) || []
      return results.length > 0 ? 0.85 : 0.4
    }
    case 'dead-code': {
      return typeof result.totalDead === 'number' ? 0.85 : 0.5
    }
    case 'find-references': {
      const total = ((result.totalGraphRefs as number) || 0) + ((result.totalTextRefs as number) || 0)
      const refs = (result.references as unknown[]) || []
      return (total > 0 || refs.length > 0) ? 0.9 : 0.5
    }
    case 'architecture':
    case 'community':
    case 'context':
    case 'edit-context':
      return 0.9
    default:
      return 0.8
  }
}

function logCall(source: 'cli' | 'mcp' | 'api', command: string, args: Record<string, unknown>, result: Record<string, unknown> | null, duration: number, status: 'success' | 'error' = 'success'): CallLogEntry {
  const entry: CallLogEntry = {
    id: generateCallId(),
    timestamp: new Date().toISOString(),
    source,
    command,
    args,
    result,
    duration,
    accuracy: result ? scoreAccuracy(command, result) : 0,
    status,
  }
  callLog.push(entry)
  if (callLog.length > 10000) callLog.shift()
  appendCallLogDisk(entry)
  return entry
}

function getDashboardHTML(logs: CallLogEntry[]): string {
  const stats = {
    totalCalls: logs.length,
    avgAccuracy: logs.length > 0 ? Math.round(logs.reduce((sum, e) => sum + (e.accuracy || 0), 0) / logs.length * 100) / 100 : 0,
    bySource: { cli: 0, mcp: 0, api: 0 } as Record<string, number>,
    byCommand: new Map<string, number>(),
    errorRate: logs.length > 0 ? Math.round(logs.filter(e => e.status === 'error').length / logs.length * 100) : 0,
  }
  for (const e of logs) {
    stats.bySource[e.source] = (stats.bySource[e.source] || 0) + 1
    stats.byCommand.set(e.command, (stats.byCommand.get(e.command) || 0) + 1)
  }

  const cmdStats = Array.from(stats.byCommand.entries()).sort((a, b) => b[1] - a[1])
  const recent = logs.slice(-50).reverse()

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CodeWiki 调用日志仪表盘</title>
<link rel="icon" type="image/svg+xml" href="/icon">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
.header{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;display:flex;align-items:center;gap:16px}
.header h1{font-size:20px;color:#58a6ff;font-weight:600}
.header .badge{background:#238636;color:white;padding:2px 8px;border-radius:12px;font-size:12px}
.container{max-width:1400px;margin:0 auto;padding:24px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px}
.stat-card .label{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:0.05em}
.stat-card .value{font-size:28px;font-weight:700;color:#f0f6fc;margin-top:4px}
.stat-card .sub{font-size:12px;color:#8b949e;margin-top:4px}
.stat-card.accent .value{color:#58a6ff}
.stat-card.green .value{color:#3fb950}
.stat-card.orange .value{color:#d29922}
.stat-card.red .value{color:#f85149}
.section{background:#161b22;border:1px solid #30363d;border-radius:12px;margin-bottom:24px;overflow:hidden}
.section-header{padding:16px 20px;border-bottom:1px solid #30363d;display:flex;align-items:center;justify-content:between;gap:12px}
.section-header h2{font-size:16px;font-weight:600}
.section-header .refresh{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px}
.section-header .refresh:hover{background:#30363d}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 16px;font-size:12px;color:#8b949e;text-transform:uppercase;background:#0d1117;font-weight:600}
td{padding:10px 16px;border-top:1px solid #21262d;font-size:13px}
tr:hover td{background:#161b22}
.badge-source{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-cli{background:#1f6feb20;color:#58a6ff}
.badge-mcp{background:#238636;color:#3fb950}
.badge-api{background:#d2992220;color:#d29922}
.badge-status{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-success{background:#23863620;color:#3fb950}
.badge-error{background:#f8514920;color:#f85149}
.accuracy-bar{width:60px;height:6px;background:#21262d;border-radius:3px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:6px}
.accuracy-fill{height:100%;border-radius:3px}
.cmd-chart{display:flex;flex-wrap:wrap;gap:8px;padding:16px 20px}
.cmd-item{background:#21262d;padding:6px 12px;border-radius:8px;font-size:12px;display:flex;align-items:center;gap:6px}
.cmd-count{color:#58a6ff;font-weight:700}
.empty{text-align:center;padding:40px;color:#8b949e}
.toolbar{display:flex;gap:8px;padding:12px 20px;border-bottom:1px solid #30363d;background:#0d1117}
.toolbar select,.toolbar input{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:6px 12px;border-radius:6px;font-size:13px}
</style>
</head>
<body>
<div class="header">
  <svg width="28" height="28" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#1a1f36"/><path d="M260 180l-36 44 36 44" stroke="#58a6ff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M340 180l36 44-36 44" stroke="#58a6ff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/><line x1="316" y1="172" x2="284" y2="276" stroke="#3fb950" stroke-width="12" stroke-linecap="round"/></svg>
  <h1>CodeWiki 调用日志</h1>
  <span class="badge">运行中</span>
  <span style="margin-left:auto;font-size:12px;color:#8b949e">项目: ${serverProjectPath}</span>
</div>
<div class="container">
  <div class="stats-grid">
    <div class="stat-card accent"><div class="label">总调用次数</div><div class="value">${stats.totalCalls}</div><div class="sub">CLI: ${stats.bySource.cli} | MCP: ${stats.bySource.mcp} | API: ${stats.bySource.api}</div></div>
    <div class="stat-card green"><div class="label">平均准确率</div><div class="value">${(stats.avgAccuracy * 100).toFixed(1)}%</div><div class="sub">基于启发式评分</div></div>
    <div class="stat-card orange"><div class="label">命令种类</div><div class="value">${stats.byCommand.size}</div><div class="sub">${cmdStats.slice(0, 3).map(([cmd]) => cmd).join(', ')}</div></div>
    <div class="stat-card ${stats.errorRate > 10 ? 'red' : 'green'}"><div class="label">错误率</div><div class="value">${stats.errorRate}%</div><div class="sub">${logs.filter(e => e.status === 'error').length} 次错误</div></div>
  </div>

  <div class="section">
    <div class="section-header"><h2>📊 命令分布</h2></div>
    <div class="cmd-chart">${cmdStats.length === 0 ? '<div class="empty">暂无调用数据</div>' : cmdStats.map(([cmd, count]) => `<div class="cmd-item"><span class="cmd-count">${count}</span>${cmd}</div>`).join('')}</div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>📋 最近调用 (最新 50 条)</h2>
      <button class="refresh" onclick="location.reload()">🔄 刷新</button>
    </div>
    <div class="toolbar">
      <select id="filterSource" onchange="filterRows()">
        <option value="all">全部来源</option><option value="cli">CLI</option><option value="mcp">MCP</option><option value="api">API</option>
      </select>
      <select id="filterStatus" onchange="filterRows()">
        <option value="all">全部状态</option><option value="success">成功</option><option value="error">错误</option>
      </select>
      <input type="text" id="filterCmd" placeholder="搜索命令..." oninput="filterRows()">
    </div>
    <table>
      <thead><tr><th>时间</th><th>来源</th><th>命令</th><th>参数</th><th>耗时</th><th>准确率</th><th>状态</th></tr></thead>
      <tbody id="logBody">
      ${recent.length === 0 ? '<tr><td colspan="7" class="empty">暂无调用记录，等待 CLI/MCP 调用...</td></tr>' : recent.map(e => {
    const accColor = (e.accuracy || 0) > 0.8 ? '#3fb950' : (e.accuracy || 0) > 0.5 ? '#d29922' : '#f85149'
    const argsStr = Object.keys(e.args).length > 0 ? JSON.stringify(e.args).substring(0, 80) : '-'
    return `<tr data-source="${e.source}" data-status="${e.status}" data-cmd="${e.command}">
        <td style="font-size:11px;color:#8b949e;white-space:nowrap">${e.timestamp.replace('T', ' ').substring(0, 19)}</td>
        <td><span class="badge-source badge-${e.source}">${e.source.toUpperCase()}</span></td>
        <td style="font-weight:600">${e.command}</td>
        <td style="font-size:11px;color:#8b949e;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${argsStr}">${argsStr}</td>
        <td>${e.duration}ms</td>
        <td><div class="accuracy-bar"><div class="accuracy-fill" style="width:${(e.accuracy || 0) * 100}%;background:${accColor}"></div></div>${((e.accuracy || 0) * 100).toFixed(0)}%</td>
        <td><span class="badge-status badge-${e.status}">${e.status === 'success' ? '成功' : '错误'}</span></td>
      </tr>`
  }).join('')}
      </tbody>
    </table>
  </div>
</div>
<script>
function filterRows(){
  const src=document.getElementById('filterSource').value
  const st=document.getElementById('filterStatus').value
  const cmd=document.getElementById('filterCmd').value.toLowerCase()
  document.querySelectorAll('#logBody tr[data-source]').forEach(r=>{
    const show=(src==='all'||r.dataset.source===src)&&(st==='all'||r.dataset.status===st)&&(!cmd||r.dataset.cmd.includes(cmd))
    r.style.display=show?'':'none'
  })
}
setTimeout(()=>location.reload(),15000)
</script>
</body>
</html>`
}

function cmdServe(projectPath: string, port: number): void {
  const absPath = path.resolve(projectPath)
  serverProjectPath = absPath

  // Pre-index the project
  console.log(`📦 Indexing project: ${absPath}`)
  const { graph, fileContents } = getGraph(absPath)
  console.log(`   ${graph.entities.length} entities, ${graph.relations.length} relations`)

  const http = require('http')
  const url = require('url')

  const server = http.createServer((req: any, res: any) => {
    const parsed = url.parse(req.url, true)
    const pathname = parsed.pathname
    const query = parsed.query

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    // Dashboard
    if (pathname === '/' || pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getDashboardHTML(readCallLogDisk()))
      return
    }

    // API: call log
    if (pathname === '/api/logs') {
      const limit = parseInt(query.limit || '100')
      const source = query.source as string
      const command = query.command as string
      let filtered = readCallLogDisk()
      if (source && source !== 'all') filtered = filtered.filter(e => e.source === source)
      if (command) filtered = filtered.filter(e => e.command.includes(command))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ logs: filtered.slice(-limit).reverse(), total: filtered.length }))
      return
    }

    // API: stats
    if (pathname === '/api/stats') {
      const diskLog = readCallLogDisk()
      const stats = {
        totalCalls: diskLog.length,
        avgAccuracy: diskLog.length > 0 ? diskLog.reduce((s, e) => s + (e.accuracy || 0), 0) / diskLog.length : 0,
        bySource: { cli: 0, mcp: 0, api: 0 } as Record<string, number>,
        byCommand: {} as Record<string, number>,
        errorRate: diskLog.length > 0 ? diskLog.filter(e => e.status === 'error').length / diskLog.length : 0,
      }
      for (const e of diskLog) {
        stats.bySource[e.source] = (stats.bySource[e.source] || 0) + 1
        stats.byCommand[e.command] = (stats.byCommand[e.command] || 0) + 1
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(stats))
      return
    }

    // API: execute command (proxied through server with logging)
    if (pathname === '/api/call') {
      let body = ''
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        try {
          const { command, args } = JSON.parse(body)
          const start = Date.now()
          let result: Record<string, unknown> = {}
          let status: 'success' | 'error' = 'success'

          try {
            // Capture output by temporarily overriding console
            const captured: string[] = []
            const origLog = console.log
            const origJson = JSON.stringify

            // Route to appropriate command
            switch (command) {
              case 'blast-radius': {
                const entity = findEntity(graph, args.entity)
                if (!entity) { result = { error: `Entity "${args.entity}" not found` }; break }
                const seeds = [entity.id]
                for (const r of graph.relations) { if (r.source === entity.id && r.type === 'contains') seeds.push(r.target) }
                const dependents = new Set<string>()
                const queue = seeds.map(id => ({ id, d: 0 }))
                while (queue.length > 0) {
                  const cur = queue.shift()!
                  if (cur.d > (args.depth || 3) || dependents.has(cur.id)) continue
                  dependents.add(cur.id)
                  for (const r of graph.relations) { if (r.target === cur.id && !dependents.has(r.source) && r.type !== 'contains') queue.push({ id: r.source, d: cur.d + 1 }) }
                }
                for (const s of seeds) dependents.delete(s)
                const depEnts = graph.entities.filter(e => dependents.has(e.id))
                const byFile = new Set(depEnts.map(e => e.filePath))
                let risk = 'low'
                if (depEnts.length > 30) risk = 'critical'
                else if (depEnts.length > 15) risk = 'high'
                else if (depEnts.length > 5) risk = 'medium'
                result = { command: 'blast-radius', entity: entity.name, risk, dependentCount: depEnts.length, affectedFiles: byFile.size }
                break
              }
              case 'callers': {
                const entity = findEntity(graph, args.entity)
                if (!entity) { result = { error: `Entity "${args.entity}" not found` }; break }
                const callers: Array<{ name: string; type: string }> = []
                for (const r of graph.relations) {
                  if (r.target === entity.id && r.type === 'calls') {
                    const caller = graph.entities.find(e => e.id === r.source)
                    if (caller) callers.push({ name: caller.name, type: caller.type })
                  }
                }
                result = { command: 'callers', entity: entity.name, callers }
                break
              }
              case 'search': {
                const docs = buildSearchDocs(fileContents, absPath)
                const results = tfidfSearch(docs, (args.query as string) || '', 10)
                result = { command: 'search', results: results.slice(0, 5) }
                break
              }
              case 'entity': {
                const entity = findEntity(graph, args.entity)
                result = entity ? { command: 'entity', entity: { name: entity.name, type: entity.type, file: entity.filePath, line: entity.line } } : { error: 'Not found' }
                break
              }
              default:
                result = { message: `Command "${command}" executed via API`, args }
            }
          } catch (err: any) {
            result = { error: err.message }
            status = 'error'
          }

          const duration = Date.now() - start
          const entry = logCall('api', command, args, result, duration, status)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ...result, _log: { id: entry.id, accuracy: entry.accuracy, duration } }))
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        }
      })
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  server.listen(port, () => {
    console.log(`\n🚀 CodeWiki 服务已启动`)
    console.log(`   仪表盘: http://localhost:${port}/dashboard`)
    console.log(`   API:    http://localhost:${port}/api/call`)
    console.log(`   日志:   http://localhost:${port}/api/logs`)
    console.log(`   统计:   http://localhost:${port}/api/stats`)
    console.log(`\n按 Ctrl+C 停止服务\n`)
  })

  // Keep alive
  process.on('SIGINT', () => {
    server.close()
    console.log('\n服务已停止')
    process.exit(0)
  })
}

// ---- Main ----

function parseArgs(raw: string[]): { command: string; positional: string[]; projectPath: string; depth: number; entities: string[]; outputFile: string } {
  let projectPath = '.'
  let depth = 3
  let entities: string[] = []
  let outputFile = ''
  const positional: string[] = []
  const flagsWithValues = new Set(['--project', '-p', '--depth', '-d', '--entities', '--output', '-o', '--ide', '--transport', '--port', '--server', '--log-dir'])

  let i = 0
  while (i < raw.length) {
    const arg = raw[i]
    if (arg.startsWith('--project=')) { projectPath = arg.split('=').slice(1).join('='); i++; continue }
    if (arg.startsWith('-p=')) { projectPath = arg.split('=').slice(1).join('='); i++; continue }
    if ((arg === '--project' || arg === '-p') && i + 1 < raw.length) { projectPath = raw[i + 1]; i += 2; continue }
    if ((arg === '--depth' || arg === '-d') && i + 1 < raw.length) { depth = parseInt(raw[i + 1]) || 3; i += 2; continue }
    if (arg === '--entities' && i + 1 < raw.length) { entities = raw[i + 1].split(',').map(s => s.trim()); i += 2; continue }
    if ((arg === '--output' || arg === '-o') && i + 1 < raw.length) { outputFile = raw[i + 1]; i += 2; continue }
    if (arg === '--json') { i++; continue }
    if (arg.startsWith('-') && flagsWithValues.has(arg)) { i += 2; continue }
    if (arg.startsWith('-')) { i++; continue }
    positional.push(arg)
    i++
  }

  return { command: positional[0] || '', positional: positional.slice(1), projectPath, depth, entities, outputFile }
}

// Commands that should NOT be recorded in the shared call log (meta / long-running / noisy).
const NON_LOGGED_COMMANDS = new Set(['serve', 'server', 'logs', 'test', 'watch', 'wiki-styles', '', 'help'])

function registerCliCallLogging(command: string, positional: string[], projectPath: string): void {
  if (NON_LOGGED_COMMANDS.has(command)) return
  const consumer = process.env.CODEWIKI_CONSUMER || 'cli'
  const t0 = Date.now()
  let logged = false
  const flush = (code: number) => {
    if (logged) return
    logged = true
    const duration = Date.now() - t0
    const status: 'success' | 'error' = code === 0 ? 'success' : 'error'
    const result = (__lastOutput && typeof __lastOutput === 'object')
      ? __lastOutput as Record<string, unknown>
      : (__lastOutput != null ? { value: __lastOutput } : null)
    const entry: CallLogEntry = {
      id: generateCallId(),
      timestamp: new Date().toISOString(),
      source: 'cli',
      command,
      args: { positional, project: projectPath, consumer },
      result,
      duration,
      accuracy: result && status === 'success' ? scoreAccuracy(command, result) : 0,
      status,
    }
    appendCallLogDisk(entry)
  }
  process.on('exit', flush)
}

function cmdLogs(positional: string[]): void {
  const getOpt = (name: string): string | undefined => {
    const argv = process.argv
    const eq = argv.find(a => a.startsWith(`--${name}=`))
    if (eq) return eq.split('=').slice(1).join('=')
    const idx = argv.indexOf(`--${name}`)
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1]
    return undefined
  }
  const sub = positional[0]
  if (sub === 'clear') {
    try { fs.rmSync(callLogFile(), { force: true }) } catch { /* ignore */ }
    output({ command: 'logs', action: 'clear', cleared: true, file: callLogFile() })
    return
  }
  const limit = parseInt(getOpt('limit') || '50', 10)
  const sourceF = getOpt('source')
  const commandF = getOpt('command')
  let logs = readCallLogDisk()
  if (sourceF && sourceF !== 'all') logs = logs.filter(e => e.source === sourceF)
  if (commandF) logs = logs.filter(e => e.command.includes(commandF))
  const recent = logs.slice(-limit).reverse()

  if (sub === 'stats') {
    const bySource: Record<string, number> = {}
    const byCommand: Record<string, number> = {}
    let accSum = 0, errs = 0
    for (const e of logs) {
      bySource[e.source] = (bySource[e.source] || 0) + 1
      byCommand[e.command] = (byCommand[e.command] || 0) + 1
      accSum += e.accuracy || 0
      if (e.status === 'error') errs++
    }
    const stats = {
      command: 'logs', action: 'stats',
      totalCalls: logs.length,
      avgAccuracy: logs.length ? Math.round((accSum / logs.length) * 1000) / 1000 : 0,
      errorRate: logs.length ? Math.round((errs / logs.length) * 1000) / 1000 : 0,
      bySource, byCommand, file: callLogFile(),
    }
    if (isJson) { output(stats); return }
    console.log(`\n  CodeWiki 调用日志统计`)
    console.log(`  ─────────────────────`)
    console.log(`  总调用:    ${stats.totalCalls}`)
    console.log(`  平均准确率: ${(stats.avgAccuracy * 100).toFixed(1)}%`)
    console.log(`  错误率:    ${(stats.errorRate * 100).toFixed(1)}%`)
    console.log(`  来源:      ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join('  ') || '(无)'}`)
    console.log(`  命令分布:  ${Object.entries(byCommand).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join('  ') || '(无)'}`)
    console.log(`  日志文件:  ${stats.file}\n`)
    return
  }

  if (isJson) { output({ command: 'logs', total: logs.length, logs: recent }); return }
  if (recent.length === 0) {
    console.log(`\n  暂无调用日志。运行 'codewiki serve' 启动服务后，消费方执行的 CLI/MCP 调用会记录到:\n  ${callLogFile()}\n`)
    return
  }
  console.log(`\n  CodeWiki 调用链路日志 (最近 ${recent.length} 条, 共 ${logs.length} 条)`)
  console.log(`  ${'时间'.padEnd(21)} ${'来源'.padEnd(5)} ${'命令'.padEnd(16)} ${'耗时'.padStart(7)} ${'准确率'.padStart(7)} 状态`)
  console.log(`  ${'─'.repeat(78)}`)
  for (const e of recent) {
    const t = e.timestamp.replace('T', ' ').slice(0, 19)
    const acc = `${Math.round((e.accuracy || 0) * 100)}%`
    const st = e.status === 'success' ? 'ok' : 'ERR'
    console.log(`  ${t.padEnd(21)} ${e.source.padEnd(5)} ${e.command.slice(0, 16).padEnd(16)} ${(e.duration + 'ms').padStart(7)} ${acc.padStart(7)} ${st}`)
  }
  console.log(`\n  日志文件: ${callLogFile()}  (codewiki logs stats | codewiki logs clear)\n`)
}

// ===================================================================
// init --ide / mcp-guide / query (NL→graph) / tui  (added in CLI overhaul)
// ===================================================================

function getCliFlag(name: string): string | undefined {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) return argv[i + 1]
    if (argv[i].startsWith(name + '=')) return argv[i].split('=').slice(1).join('=')
  }
  return undefined
}

function hasCliFlag(name: string): boolean {
  return process.argv.slice(2).includes(name)
}

// Resolve how to launch the bundled MCP server (prefer compiled, fall back to ts-node on source).
function resolveMcpServer(): { command: string; args: string[]; mode: string } {
  const root = path.resolve(__dirname, '..')
  const built = path.join(root, 'dist', 'server', 'mcp-server.js')
  if (fs.existsSync(built)) return { command: 'node', args: [built], mode: 'compiled' }
  const src = path.join(root, 'server', 'mcp-server.ts')
  if (fs.existsSync(src)) return { command: 'npx', args: ['-y', 'ts-node', src], mode: 'ts-node (source — run `npm run build:mcp` for faster startup)' }
  return { command: 'node', args: [built], mode: 'compiled (run `npm run build:mcp` first — file not found yet)' }
}

type IdeId = 'cursor' | 'vscode' | 'claude' | 'claude-code' | 'windsurf' | 'cline' | 'codex'

const IDE_ALIASES: Record<string, IdeId> = {
  cursor: 'cursor',
  vscode: 'vscode', 'vs-code': 'vscode', code: 'vscode', copilot: 'vscode',
  claude: 'claude', 'claude-desktop': 'claude', claudedesktop: 'claude',
  'claude-code': 'claude-code', claudecode: 'claude-code',
  windsurf: 'windsurf', codeium: 'windsurf',
  cline: 'cline', roo: 'cline', 'roo-code': 'cline',
  codex: 'codex',
}

const ALL_IDES: IdeId[] = ['cursor', 'vscode', 'claude', 'claude-code', 'windsurf', 'cline', 'codex']

// Build the standard MCP server entry ({command,args,env}). VS Code adds type:'stdio'.
function mcpEntry(projectAbs: string, opts: { workspaceVar?: boolean; vscode?: boolean }): Record<string, unknown> {
  const srv = resolveMcpServer()
  const env: Record<string, string> = {
    PROJECT_PATH: opts.workspaceVar ? '${workspaceFolder}' : projectAbs,
  }
  const logDir = getCliFlag('--log-dir')
  if (logDir) env.CODEWIKI_LOG_DIR = logDir
  const entry: Record<string, unknown> = { command: srv.command, args: srv.args, env }
  if (opts.vscode) return { type: 'stdio', ...entry }
  return entry
}

// Merge a codewiki server into an existing JSON config under the given container key.
function writeMergedMcpJson(filePath: string, containerKey: 'mcpServers' | 'servers', entry: Record<string, unknown>, written: string[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  let root: Record<string, unknown> = {}
  if (fs.existsSync(filePath)) {
    try { root = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown> } catch { root = {} }
  }
  const container = (root[containerKey] && typeof root[containerKey] === 'object')
    ? root[containerKey] as Record<string, unknown>
    : {}
  container.codewiki = entry
  root[containerKey] = container
  fs.writeFileSync(filePath, JSON.stringify(root, null, 2) + '\n', 'utf-8')
  written.push(filePath)
}

function ideConfigTarget(ide: IdeId, projectAbs: string): { file: string; container: 'mcpServers' | 'servers'; entry: Record<string, unknown>; note: string } {
  switch (ide) {
    case 'cursor':
      return { file: path.join(projectAbs, '.cursor', 'mcp.json'), container: 'mcpServers', entry: mcpEntry(projectAbs, {}), note: '在 Cursor → Settings → MCP 启用 codewiki' }
    case 'vscode':
      return { file: path.join(projectAbs, '.vscode', 'mcp.json'), container: 'servers', entry: mcpEntry(projectAbs, { workspaceVar: true, vscode: true }), note: 'VS Code (Copilot agent 模式) 自动读取 .vscode/mcp.json' }
    case 'claude-code':
      return { file: path.join(projectAbs, '.mcp.json'), container: 'mcpServers', entry: mcpEntry(projectAbs, {}), note: 'Claude Code 自动读取项目根的 .mcp.json' }
    case 'windsurf':
      return { file: path.join(projectAbs, '.windsurf', 'mcp.json'), container: 'mcpServers', entry: mcpEntry(projectAbs, {}), note: 'Windsurf 全局配置在 ~/.codeium/windsurf/mcp_config.json — 可把本文件内容并入其中' }
    case 'cline':
      return { file: path.join(projectAbs, '.cline', 'mcp.json'), container: 'mcpServers', entry: mcpEntry(projectAbs, {}), note: 'Cline 设置里指向本文件，或把内容并入 Cline 的 MCP 设置' }
    case 'codex':
      return { file: path.join(projectAbs, '.codewiki', 'codex-mcp.json'), container: 'mcpServers', entry: mcpEntry(projectAbs, {}), note: 'Codex/通用 MCP 客户端可复用此 mcpServers 片段' }
    case 'claude':
    default:
      // Real path is OS app dir; write a project-local snippet + instructions.
      return { file: path.join(projectAbs, '.codewiki', 'claude_desktop_config.json'), container: 'mcpServers', entry: mcpEntry(projectAbs, {}), note: '把本文件内容合并到 Claude Desktop 配置：macOS ~/Library/Application Support/Claude/claude_desktop_config.json · Windows %APPDATA%\\Claude\\claude_desktop_config.json · Linux ~/.config/Claude/claude_desktop_config.json' }
  }
}

const AGENT_USAGE_MD = `# CodeWiki — agent 使用约定

本项目已接入 **CodeWiki MCP** 代码本体（ontology）服务。改动代码前，code agent 应优先用 CodeWiki 工具理解结构，避免把代码当纯文本猜测。

## 推荐工作流
1. **改动前先查影响**：用 \`analyze_impact\` / \`get_callers\` 评估"爆炸半径"，确认会被波及的实体与文件。
2. **定位实体**：用 \`search_code\` / \`get_entity\` / \`find_references\` 精确定位定义与引用，而非全文搜索。
3. **理解依赖**：用 \`get_dependencies\` / \`trace_path\` 看调用链与依赖路径。
4. **改完验证**：如启用，运行项目自带的 lint/build/test 验证。

## 也可用 CLI（无需 IDE）
- \`codewiki query "谁调用了 functionName"\` — 自然语言图查询
- \`codewiki impact <Entity>\` / \`codewiki callers <Entity>\` / \`codewiki deps <Entity>\`
- \`codewiki tui\` — 交互式控制台

> 此文件由 \`codewiki init\` 生成，供 code agent 消费。可按需修改。
`

function cmdInit(projectPath: string): void {
  const projectAbs = path.resolve(projectPath)
  if (!fs.existsSync(projectAbs)) { console.error(`错误: 项目路径不存在: ${projectAbs}`); process.exit(1) }

  const printOnly = hasCliFlag('--print')
  const ideRaw = (getCliFlag('--ide') || '').toLowerCase().trim()
  const written: string[] = []

  // 1) .codewikirc (existing default config) — create if missing
  const rcPath = path.join(projectAbs, '.codewikirc')
  if (!printOnly && !fs.existsSync(rcPath)) {
    const defaultConfig: CLIConfig = {
      indexing: { maxDepth: 8, maxFileSize: 500000, extensions: ['.ts', '.tsx', '.js', '.jsx', '.py'], ignoreDirs: ['node_modules', '.git', 'dist', 'build'] },
      llm: { provider: 'openai', model: 'gpt-4o' },
      ontology: { impactDepth: 3 },
      search: { maxResults: 10, minScore: 0.01 },
    }
    fs.writeFileSync(rcPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8')
    written.push(rcPath)
  }

  // 2) Resolve which IDE(s)
  let ides: IdeId[]
  if (!ideRaw || ideRaw === 'all') {
    ides = ALL_IDES
  } else {
    ides = ideRaw.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const id = IDE_ALIASES[s]
      if (!id) { console.error(`错误: 不支持的 IDE "${s}"。可选: ${Object.keys(IDE_ALIASES).join(', ')}, all`); process.exit(1) }
      return id
    })
  }

  const srv = resolveMcpServer()

  if (printOnly) {
    for (const ide of ides) {
      const t = ideConfigTarget(ide, projectAbs)
      const root: Record<string, unknown> = { [t.container]: { codewiki: t.entry } }
      console.log(`\n  # ${ide}  →  ${path.relative(projectAbs, t.file) || t.file}`)
      console.log(`  # ${t.note}`)
      console.log(JSON.stringify(root, null, 2))
    }
    console.log(`\n  MCP server: ${srv.command} ${srv.args.join(' ')}  [${srv.mode}]\n`)
    return
  }

  for (const ide of ides) {
    const t = ideConfigTarget(ide, projectAbs)
    writeMergedMcpJson(t.file, t.container, t.entry, written)
  }

  // 3) agent usage rules
  const usagePath = path.join(projectAbs, '.codewiki', 'agent-usage.md')
  fs.mkdirSync(path.dirname(usagePath), { recursive: true })
  fs.writeFileSync(usagePath, AGENT_USAGE_MD, 'utf-8')
  written.push(usagePath)

  console.log(`\n  CodeWiki 初始化完成`)
  console.log(`  ─────────────────────`)
  console.log(`  项目:       ${projectAbs}`)
  console.log(`  MCP server: ${srv.command} ${srv.args.join(' ')}  [${srv.mode}]`)
  console.log(`  IDE:        ${ides.join(', ')}`)
  console.log(`\n  已写入 ${written.length} 个文件:`)
  for (const f of written) console.log(`    + ${path.relative(projectAbs, f) || f}`)
  console.log(`\n  下一步:`)
  if (srv.mode.startsWith('compiled (run')) console.log(`    1. 先构建 MCP server: npm run build:mcp`)
  console.log(`    • 在对应 IDE 中启用 codewiki MCP（见 codewiki mcp-guide <ide>）`)
  console.log(`    • 校验: codewiki mcp-guide --verify\n`)
}

function cmdMcpGuide(ideArg: string | undefined): void {
  if (hasCliFlag('--verify')) {
    const srv = resolveMcpServer()
    console.log(`\n  MCP server 启动命令: ${srv.command} ${srv.args.join(' ')}  [${srv.mode}]`)
    console.log(`  手动验证 (列出工具):`)
    console.log(`    PROJECT_PATH="$(pwd)" ${srv.command} ${srv.args.join(' ')}`)
    console.log(`  正常输出 (stderr): "CodeWiki MCP Server running on stdio." + 工具数量\n`)
    return
  }

  const ide = ideArg ? IDE_ALIASES[ideArg.toLowerCase()] : undefined
  const srv = resolveMcpServer()
  const cmdLine = `"command": ${JSON.stringify(srv.command)}, "args": ${JSON.stringify(srv.args)}`

  console.log(`\n  CodeWiki MCP 配置指导`)
  console.log(`  ─────────────────────`)
  console.log(`  MCP server: ${srv.command} ${srv.args.join(' ')}  [${srv.mode}]`)
  console.log(`  最快方式: 在项目目录运行  codewiki init --ide <${ALL_IDES.join('|')}|all>`)
  console.log(`  完整文档: docs/MCP.md (中文 docs/MCP.zh-CN.md)\n`)

  const blocks: Record<IdeId, string> = {
    cursor: `Cursor → 写入 .cursor/mcp.json，键 mcpServers，然后 Settings → MCP 启用 codewiki。`,
    vscode: `VS Code (Copilot agent) → 写入 .vscode/mcp.json，顶层键是 servers，需 "type":"stdio"，env.PROJECT_PATH 用 \${workspaceFolder}。`,
    claude: `Claude Desktop → 编辑 claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/ · Windows: %APPDATA%\\Claude\\ · Linux: ~/.config/Claude/)，键 mcpServers，重启 Claude。`,
    'claude-code': `Claude Code → 项目根 .mcp.json，键 mcpServers。`,
    windsurf: `Windsurf → ~/.codeium/windsurf/mcp_config.json，键 mcpServers。`,
    cline: `Cline → 在扩展的 MCP 设置中添加同样的 command/args/env。`,
    codex: `Codex / 通用客户端 → 复用 mcpServers 片段 (command/args/env)。`,
  }

  const toShow: IdeId[] = ide ? [ide] : ALL_IDES
  for (const k of toShow) {
    console.log(`  • ${k}: ${blocks[k]}`)
  }
  console.log(`\n  通用片段:`)
  console.log(`    { "mcpServers": { "codewiki": { ${cmdLine}, "env": { "PROJECT_PATH": "/abs/项目路径" } } } }\n`)
}

// ---- Natural-language → graph query (surfaces graph-query capability in the CLI) ----

interface NlIntent { op: string; a?: string; b?: string }

function parseNlQuery(text: string): NlIntent | null {
  const t = text.trim()
  const low = t.toLowerCase()
  const stop = /\b(of|the|to|for|on|in|a|an|是|的|了|吗|呢|请|帮我|一下)\b/gi

  // path: X to Y / X 到 Y / from X to Y
  let m = low.match(/(?:path|trace|route|链路|路径)\D*?([\w$.]+)\s*(?:to|->|→|到|至)\s*([\w$.]+)/i)
    || t.match(/([\w$.]+)\s*(?:到|至|->|→)\s*([\w$.]+)\s*(?:的)?(?:路径|链路)/)
  if (m) return { op: 'path', a: m[1], b: m[2] }

  const grab = (re: RegExp): string | undefined => { const r = t.match(re); return r ? r[1] : undefined }

  // callers: who calls X / callers of X / 谁调用 X / X 的调用者
  if (/who\s+calls|callers?\s+of|caller|谁(调用|引用|用了)|调用者|被谁/i.test(low)) {
    const a = grab(/(?:who\s+calls|callers?\s+of|谁(?:调用|引用|用了)|调用者[是为]?)\s*([\w$.]+)/i)
      || grab(/([\w$.]+)\s*(?:的)?(?:调用者|被谁调用)/)
    if (a) return { op: 'callers', a }
  }
  // callees: what does X call / callees of X / X 调用了什么 / X 调用谁
  if (/what\s+does\s+\S+\s+call|callees?\s+of|callee|调用了(什么|谁)|调用哪些/i.test(low)) {
    const a = grab(/what\s+does\s+([\w$.]+)\s+call/i)
      || grab(/callees?\s+of\s+([\w$.]+)/i)
      || grab(/([\w$.]+)\s*(?:调用了什么|调用哪些|调用谁)/)
    if (a) return { op: 'callees', a }
  }
  // impact: impact of X / what breaks if I change X / X 的影响 / 改 X
  if (/impact|affect|blast|break|改了|修改|变更|影响|波及/i.test(low)) {
    const a = grab(/(?:impact\s+of|affect(?:ed|s)?\s+by|changing|change|modif\w*)\s+([\w$.]+)/i)
      || grab(/(?:改了?|修改|变更)\s*([\w$.]+)/)
      || grab(/([\w$.]+)\s*(?:的)?(?:影响|波及)/)
    if (a) return { op: 'impact', a }
  }
  // references: references to X / X 的引用
  if (/references?\s+to|refs?\s+of|引用|用到/i.test(low)) {
    const a = grab(/references?\s+to\s+([\w$.]+)/i) || grab(/refs?\s+of\s+([\w$.]+)/i)
      || grab(/([\w$.]+)\s*(?:的)?(?:引用)/)
    if (a) return { op: 'refs', a }
  }
  // dependencies: dependencies of X / X 依赖什么
  if (/depend|dependenc|依赖/i.test(low)) {
    const a = grab(/dependenc\w*\s+of\s+([\w$.]+)/i) || grab(/([\w$.]+)\s*(?:的)?(?:依赖)/)
    if (a) return { op: 'deps', a }
  }

  // fallback to search
  const cleaned = t.replace(stop, ' ').trim()
  return cleaned ? { op: 'search', a: cleaned } : null
}

function cmdQuery(text: string, projectPath: string, depth: number): void {
  if (!text || !text.trim()) { console.error('用法: codewiki query "<自然语言问题>"'); process.exit(1) }
  const intent = parseNlQuery(text)
  if (!intent) { console.error('无法解析该问题'); process.exit(1) }
  if (!isJson) {
    const label: Record<string, string> = { callers: '调用者', callees: '被调用', impact: '影响分析', refs: '引用', deps: '依赖', path: '路径', search: '搜索' }
    console.log(`\n  解析: ${label[intent.op] || intent.op}${intent.a ? '  →  ' + intent.a : ''}${intent.b ? '  →  ' + intent.b : ''}`)
  }
  switch (intent.op) {
    case 'callers': cmdCallers(intent.a as string, projectPath, depth); break
    case 'callees': cmdCallees(intent.a as string, projectPath, depth); break
    case 'impact': cmdImpact(intent.a as string, projectPath, depth); break
    case 'refs': cmdFindReferences(intent.a as string, projectPath); break
    case 'deps': cmdDeps(intent.a as string, projectPath, depth); break
    case 'path': cmdDependencyPath(intent.a as string, intent.b as string, projectPath, depth); break
    default: cmdSearch(intent.a as string, projectPath)
  }
}

// ---- Interactive TUI console ----

function cmdTui(projectPath: string, depth: number): void {
  const projectAbs = path.resolve(projectPath)
  if (!fs.existsSync(projectAbs)) { console.error(`错误: 项目路径不存在: ${projectAbs}`); process.exit(1) }

  const CLR = '\x1b[2J\x1b[3J\x1b[H'
  const C = { dim: '\x1b[2m', b: '\x1b[1m', cy: '\x1b[36m', gr: '\x1b[32m', yl: '\x1b[33m', rs: '\x1b[0m' }
  let stats = { entities: 0, relations: 0 }
  try { const { graph } = getGraph(projectAbs); stats = { entities: graph.entities.length, relations: graph.relations.length } } catch { /* index lazily */ }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res))

  const menu: Array<{ k: string; label: string; run: (arg: string) => void | Promise<void>; arg?: string }> = [
    { k: '1', label: '搜索 (TF-IDF)', arg: '关键词', run: (a) => cmdSearch(a, projectAbs) },
    { k: '2', label: '自然语言查询 (NL→图)', arg: '问题，如"谁调用 fooBar"', run: (a) => cmdQuery(a, projectAbs, depth) },
    { k: '3', label: '影响分析 (impact)', arg: '实体名', run: (a) => cmdImpact(a, projectAbs, depth) },
    { k: '4', label: '调用者 (callers)', arg: '实体名', run: (a) => cmdCallers(a, projectAbs, depth) },
    { k: '5', label: '依赖 (deps)', arg: '实体名', run: (a) => cmdDeps(a, projectAbs, depth) },
    { k: '6', label: '实体详情 (entity)', arg: '实体名', run: (a) => cmdEntity(a, projectAbs) },
    { k: '7', label: '架构概览 (architecture)', run: () => cmdArchitecture(projectAbs) },
    { k: '8', label: '关键符号 (PageRank)', run: () => cmdPageRank(projectAbs, 15) },
    { k: '9', label: '死代码 (dead-code)', run: () => cmdDeadCode(projectAbs) },
    { k: '0', label: '重新索引 (index)', run: () => { cmdIndex(projectAbs); const { graph } = getGraph(projectAbs); stats = { entities: graph.entities.length, relations: graph.relations.length } } },
  ]

  function draw(): void {
    process.stdout.write(CLR)
    console.log(`${C.cy}${C.b}  ╔══════════════════════════════════════════════════════╗${C.rs}`)
    console.log(`${C.cy}${C.b}  ║   CodeWiki TUI 控制台                                 ║${C.rs}`)
    console.log(`${C.cy}${C.b}  ╚══════════════════════════════════════════════════════╝${C.rs}`)
    console.log(`  ${C.dim}项目:${C.rs} ${projectAbs}`)
    console.log(`  ${C.dim}本体:${C.rs} ${C.gr}${stats.entities}${C.rs} 实体 · ${C.gr}${stats.relations}${C.rs} 关系   ${C.dim}depth=${depth}${C.rs}`)
    console.log(`  ${'─'.repeat(56)}`)
    for (const m of menu) console.log(`   ${C.yl}${m.k}${C.rs}  ${m.label}`)
    console.log(`   ${C.yl}q${C.rs}  退出`)
    console.log(`  ${'─'.repeat(56)}`)
  }

  async function loop(): Promise<void> {
    for (;;) {
      draw()
      const choice = (await ask(`\n  选择> `)).trim().toLowerCase()
      if (choice === 'q' || choice === 'quit' || choice === 'exit') break
      const item = menu.find(m => m.k === choice)
      if (!item) continue
      let arg = ''
      if (item.arg) {
        arg = (await ask(`  ${item.arg}: `)).trim()
        if (!arg) continue
      }
      process.stdout.write(CLR)
      console.log(`${C.cy}${C.b}  ▶ ${item.label}${arg ? ': ' + arg : ''}${C.rs}\n`)
      try { await item.run(arg) } catch (e) { console.error(`  ${C.yl}错误:${C.rs} ${(e as Error).message}`) }
      await ask(`\n  ${C.dim}按 Enter 返回菜单…${C.rs}`)
    }
    rl.close()
    console.log(`\n  ${C.gr}再见 👋${C.rs}\n`)
  }

  void loop()
}

function readPkgVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')) as { version?: string }
    return pkg.version || 'unknown'
  } catch { return 'unknown' }
}

function main() {
  const { command, positional, projectPath, depth, entities, outputFile } = parseArgs(process.argv.slice(2))

  if (command === 'version' || process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log(`codewiki ${readPkgVersion()}`)
    return
  }

  registerCliCallLogging(command, positional, projectPath)

  switch (command) {
    case 'logs':
      cmdLogs(positional)
      break
    case 'index':
      cmdIndex(positional[0] || projectPath)
      break
    case 'analyze':
      if (positional.length === 0) { console.error('Usage: codewiki analyze <query> [--project <path>]'); process.exit(1) }
      cmdAnalyze(positional.join(' '), projectPath, depth)
      break
    case 'search':
      if (positional.length === 0) { console.error('Usage: codewiki search <query>'); process.exit(1) }
      cmdSearch(positional.join(' '), projectPath)
      break
    case 'entity':
      if (!positional[0]) { console.error('Usage: codewiki entity <name>'); process.exit(1) }
      cmdEntity(positional[0], projectPath)
      break
    case 'impact':
      if (!positional[0]) { console.error('Usage: codewiki impact <entity-name>'); process.exit(1) }
      cmdImpact(positional[0], projectPath, depth)
      break
    case 'deps':
      if (!positional[0]) { console.error('Usage: codewiki deps <entity-name>'); process.exit(1) }
      cmdDeps(positional[0], projectPath, depth)
      break
    case 'validate':
      if (!positional[0] || !positional[1] || !positional[2]) { console.error('Usage: codewiki validate <file> <startLine> <endLine> [--project <path>]'); process.exit(1) }
      cmdValidate(positional[0], parseInt(positional[1]), parseInt(positional[2]), projectPath)
      break
    case 'pre-check':
      if (!positional[0]) { console.error('Usage: codewiki pre-check <entity-or-file> [description...] [--project <path>]'); process.exit(1) }
      cmdPreCheck(positional[0], positional.slice(1).join(' '), projectPath, depth)
      break
    case 'verify':
      if (!positional[0]) { console.error('Usage: codewiki verify <file> [--project <path>]'); process.exit(1) }
      cmdVerify(positional[0], projectPath)
      break
    case 'apply':
      if (positional.length >= 4) {
        // codewiki apply <file> <startLine> <endLine> "<newContent>"
        cmdApply(positional[0], parseInt(positional[1]), parseInt(positional[2]), positional.slice(3).join(' '), projectPath)
      } else if (positional[0] && positional[0].endsWith('.json')) {
        // codewiki apply plan.json (batch mode)
        cmdApplyJson(positional[0], projectPath)
      } else {
        console.error('Usage: codewiki apply <file> <startLine> <endLine> "<newContent>" OR codewiki apply <plan.json>')
        process.exit(1)
      }
      break
    case 'rollback':
      if (!positional[0]) { console.error('Usage: codewiki rollback <file> [--project <path>]'); process.exit(1) }
      cmdRollback(positional[0], projectPath)
      break
    case 'diff':
      if (!positional[0]) { console.error('Usage: codewiki diff <file> [--project <path>]'); process.exit(1) }
      cmdDiff(positional[0], projectPath)
      break
    case 'status':
      cmdStatus(projectPath)
      break
    case 'config':
      cmdConfig(positional[0] || 'get', positional[1], positional[2], projectPath)
      break
    case 'relations':
      if (!positional[0]) { console.error('Usage: codewiki relations <entity-name> [--project <path>]'); process.exit(1) }
      cmdRelations(positional[0], projectPath)
      break
    case 'batch':
      if (!positional[0]) { console.error('Usage: codewiki batch <pre-check|impact|apply> --entities e1,e2,... [--project <path>]'); process.exit(1) }
      cmdBatch(positional[0], entities.length > 0 ? entities : positional.slice(1), projectPath, depth)
      break
    case 'export':
      if (!positional[0]) { console.error('Usage: codewiki export <markdown|html|json> [--output <file>] [--project <path>]'); process.exit(1) }
      cmdExport(positional[0], outputFile || positional[1], projectPath)
      break
    case 'callers':
      if (!positional[0]) { console.error('Usage: codewiki callers <entity-name> [--project <path>]'); process.exit(1) }
      cmdCallers(positional[0], projectPath, depth)
      break
    case 'callees':
      if (!positional[0]) { console.error('Usage: codewiki callees <entity-name> [--project <path>]'); process.exit(1) }
      cmdCallees(positional[0], projectPath, depth)
      break
    case 'trace':
      if (!positional[0] || !positional[1]) { console.error('Usage: codewiki trace <from-entity> <to-entity> [--project <path>]'); process.exit(1) }
      cmdTrace(positional[0], positional[1], projectPath, depth)
      break
    case 'blast-radius':
      if (!positional[0]) { console.error('Usage: codewiki blast-radius <entity-name> [--project <path>]'); process.exit(1) }
      cmdBlastRadius(positional[0], projectPath, depth)
      break
    case 'context':
      if (positional.length === 0) { console.error('Usage: codewiki context <query> [--intent explain|modify|debug|test] [--project <path>]'); process.exit(1) }
      cmdContext(positional.join(' '), process.argv.includes('--intent') ? process.argv[process.argv.indexOf('--intent') + 1] || 'explain' : 'explain', projectPath, depth)
      break
    case 'edit-context':
      if (!positional[0]) { console.error('Usage: codewiki edit-context <entity-name> [--project <path>]'); process.exit(1) }
      cmdEditContext(positional[0], projectPath, depth)
      break
    case 'explore':
      if (entities.length === 0 && positional.length === 0) { console.error('Usage: codewiki explore --entities e1,e2,e3 [--project <path>]'); process.exit(1) }
      cmdExplore(entities.length > 0 ? entities : positional, projectPath)
      break
    case 'dependency-path':
      if (!positional[0] || !positional[1]) { console.error('Usage: codewiki dependency-path <from> <to> [--project <path>]'); process.exit(1) }
      cmdDependencyPath(positional[0], positional[1], projectPath, depth)
      break
    case 'file-context':
      if (!positional[0]) { console.error('Usage: codewiki file-context <file-path> [--project <path>]'); process.exit(1) }
      cmdFileContext(positional[0], projectPath)
      break
    case 'complexity':
      if (!positional[0]) { console.error('Usage: codewiki complexity <entity-name> [--project <path>]'); process.exit(1) }
      cmdComplexity(positional[0], projectPath)
      break
    case 'lsif':
    case 'scip':
      cmdLsifStatus(projectPath)
      break
    case 'dead-code':
      cmdDeadCode(projectPath)
      break
    case 'health':
    case 'health-score':
      cmdHealth(projectPath)
      break
    case 'churn':
    case 'hotspots':
      cmdChurn(projectPath, depth * 5 || 20)
      break
    case 'ownership':
    case 'owners':
      if (!positional[0]) { console.error('Usage: codewiki ownership <file> [--project <path>]'); process.exit(1) }
      cmdOwnership(positional[0], projectPath)
      break
    case 'scan':
    case 'security':
      cmdScan(projectPath)
      break
    case 'find-references':
    case 'references':
      if (!positional[0]) { console.error('Usage: codewiki find-references <entity-name> [--project <path>]'); process.exit(1) }
      cmdFindReferences(positional[0], projectPath)
      break
    case 'pagerank':
    case 'key-symbols':
      cmdPageRank(projectPath, depth * 5 || 15)
      break
    case 'trace-route':
      if (!positional[0]) { console.error('Usage: codewiki trace-route <route-path> [--project <path>]'); process.exit(1) }
      cmdTraceRoute(positional[0], projectPath, depth)
      break
    case 'watch':
      cmdWatch(projectPath)
      break
    case 'architecture':
    case 'arch':
      cmdArchitecture(projectPath)
      break
    case 'git-diff':
    case 'diff-impact':
      cmdGitDiffImpact(projectPath, depth)
      break
    case 'community':
    case 'clusters':
      cmdCommunityDetect(projectPath)
      break
    case 'suggest-tests':
      if (!positional[0]) { console.error('Usage: codewiki suggest-tests <entity-name> [--project <path>]'); process.exit(1) }
      cmdSuggestTests(positional[0], projectPath, depth)
      break
    case 'wiki-check':
    case 'wiki-validate':
      if (!positional[0]) { console.error('Usage: codewiki wiki-check <wiki.md|wiki-dir> [--json]'); process.exit(1) }
      cmdWikiCheck(positional[0])
      break
    case 'wiki-styles':
    case 'wiki-templates':
      cmdWikiStyles(positional[0], positional[1])
      break
    case 'wiki-generate':
    case 'wiki-gen': {
      const getFlagVal = (name: string, def: string): string => {
        const argv = process.argv
        const eq = argv.find(a => a.startsWith(`--${name}=`))
        if (eq) return eq.split('=').slice(1).join('=')
        const idx = argv.indexOf(`--${name}`)
        if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1]
        return def
      }
      const style = getFlagVal('style', 'hierarchical')
      const provider = getFlagVal('provider', 'deepseek')
      const model = getFlagVal('model', provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat')
      const outDir = outputFile || getFlagVal('out', 'wiki-output')
      cmdWikiGenerate(projectPath, { style, provider, model, outDir }).catch(err => {
        output({ command: 'wiki-generate', success: false, error: (err as Error).message })
        process.exit(1)
      })
      break
    }
    case 'serve':
    case 'server':
      cmdServe(projectPath, parseInt(positional[0] || '3777', 10))
      break
    case 'debug':
    case 'repl':
      cmdDebug(projectPath, depth)
      break
    case 'tui':
    case 'console':
      cmdTui(projectPath, depth)
      break
    case 'init':
      cmdInit(positional[0] || projectPath)
      break
    case 'mcp-guide':
    case 'mcp':
      cmdMcpGuide(positional[0])
      break
    case 'query':
    case 'ask':
      if (positional.length === 0) { console.error('Usage: codewiki query "<natural language question>" [--project <path>]'); process.exit(1) }
      cmdQuery(positional.join(' '), projectPath, depth)
      break
    case 'test':
      cmdTest(positional[0] || path.join(__dirname, '..', 'test-fixtures'), projectPath)
      break
    default:
      console.log(`
CodeWiki CLI — Ontology-based code analysis for AI coding accuracy

Commands:
  index <path>                        Index a project and cache ontology
  analyze <query>                     Full analysis (entities + search + impact)
  search <query>                      Semantic search across codebase
  entity <name>                       Get entity info from ontology
  impact <entity-name>                Impact analysis
  deps <entity-name>                  Dependency graph
  relations <entity-name>             All relations for an entity
  validate <file> <s> <e>             Validate modification safety
  pre-check <entity> [desc]           Comprehensive pre-modification analysis
  verify <file>                       Post-modification verification
  apply <file> <s> <e> "<content>"    Apply a code modification
  apply <plan.json>                   Batch apply from JSON plan
  rollback <file>                     Rollback to last backup
  diff <file>                         Show changes vs backup
  status                              Project index status and stats
  config init                         Create .codewikirc config file
  config get [key]                    Read config (or specific key)
  config set <key> <value>            Set a config value
  batch <cmd> --entities e1,e2,...    Batch operations (pre-check, impact, apply)
  export <format> [output]            Export wiki (markdown, html, json)
  callers <entity-name>                Find all callers of an entity (who calls this?)
  callees <entity-name>                Find all callees of an entity (what does this call?)
  trace <from> <to>                    Trace call path between two entities
  blast-radius <entity-name>           Blast radius analysis (upstream dependents)
  context <query>                      Smart context builder (one call, full context)
  edit-context <entity-name>           Pre-edit context (source+callers+callees+tests)
  explore --entities e1,e2,...          Multi-symbol source grouped by file
  dependency-path <from> <to>          Shortest dependency path between entities
  file-context <file>                  All imports/exports/symbols for a file
  complexity <entity-name>             Cyclomatic complexity analysis
  lsif                                LSIF/SCIP index status and generator info
  dead-code                           Find unreferenced symbols (dead code)
  find-references <entity-name>       All usage sites of a symbol
  pagerank                            Rank symbols by structural importance (PageRank)
  trace-route <route-path>            HTTP route → handler → service chain trace
  watch                               Watch for file changes and auto-reindex
  architecture                        Architecture overview (languages, entry points, hotspots, clusters)
  git-diff                            Git diff impact (map uncommitted changes to affected symbols)
  community                           Community detection (group related symbols into functional clusters)
  suggest-tests <entity-name>         Suggest which tests to run after modifying an entity
  wiki-check <wiki.md|dir>            Validate generated wiki structure/quality (alignment score)
  wiki-styles [show <id>]             List/show wiki prompt-style templates
  wiki-generate [--style <id>]        Generate a wiki via LLM (needs CODEWIKI_API_KEY/DEEPSEEK_API_KEY)
  serve [port]                        Start CodeWiki server with call logging dashboard (default: 3777)
  tui | console                       Interactive full-screen TUI console (menu-driven)
  query | ask "<question>"             Natural-language → graph query (callers/impact/deps/path/search; 中英双语)
  init [--ide <name>]                 Export IDE MCP config into the project (cursor|vscode|claude|claude-code|windsurf|cline|codex|all)
  mcp-guide [<ide>] [--verify]        Print MCP setup guidance per IDE
  debug | repl                        Start the interactive CLI debugger (REPL) — run any command, keep project loaded
  logs [stats|clear]                  View shared CLI/MCP call trace (--source --command --limit)
  test [suite-path]                   Run accuracy test suite

Flags:
  --json                    Output machine-readable JSON
  --project, -p <path>      Project path (default: cwd)
  --depth, -d <n>           Traversal depth (default: 3)
  --entities <e1,e2,...>    Entity list for batch operations

Code Agent Workflow:
  1. codewiki index ./project
  2. codewiki pre-check UserService "add caching" --json -p ./project
  3. codewiki apply src/user.ts 10 15 "new code here" -p ./project
  4. codewiki verify src/user.ts -p ./project
  5. codewiki diff src/user.ts -p ./project
  (if something went wrong:)
  6. codewiki rollback src/user.ts -p ./project

Advanced Workflow:
  codewiki callers UserService --json -p ./project          # Who calls this?
  codewiki callees UserService --json -p ./project          # What does this call?
  codewiki blast-radius UserService --json -p ./project     # What breaks if I change this?
  codewiki dead-code --json -p ./project                    # Find unused code
  codewiki find-references getUser --json -p ./project      # All usages of a symbol
  codewiki pagerank --json -p ./project                     # Key symbols by PageRank
  codewiki trace-route /api/users --json -p ./project       # HTTP request chain
  codewiki lsif -p ./project                                # LSIF/SCIP status

IDE / MCP Setup (for code agents):
  codewiki init --ide cursor -p ./project      # write .cursor/mcp.json
  codewiki init --ide vscode -p ./project      # write .vscode/mcp.json (servers/type:stdio)
  codewiki init --ide all --print              # preview all IDE configs without writing
  codewiki mcp-guide cursor                    # per-IDE setup instructions
  codewiki query "who calls indexProject" -p ./project

LSIF/SCIP Setup (compiler-accurate indexing):
  TypeScript:  npm i -g @sourcegraph/scip-typescript && scip-typescript index
  Python:      pip install scip-python && scip-python index
  Java:        See https://github.com/sourcegraph/scip-java
  Rust:        rust-analyzer scip .
`)
  }
}

// ---- Test Runner ----

interface TestCase {
  name: string
  type: 'entity_extraction' | 'relation_detection' | 'impact_analysis' | 'search_relevance' | 'validate_safety' | 'callers' | 'callees' | 'blast_radius' | 'dead_code' | 'find_references' | 'pagerank' | 'confidence'
  project?: string
  expected_entities?: Array<{ name: string; type: string; file?: string }>
  expected_relations?: Array<{ source: string; target: string; type: string }>
  modify_entity?: string
  expected_impacted?: string[]
  not_impacted?: string[]
  query?: string
  expected_top3?: string[]
  validate_file?: string
  validate_range?: [number, number]
  should_warn?: boolean
  // Callers/callees tests
  entity?: string
  expected_callers?: string[]
  expected_callees?: string[]
  // Blast radius tests
  min_dependents?: number
  expected_risk?: string
  // Dead code tests
  expected_dead?: string[]
  not_dead?: string[]
  // Find references tests
  min_refs?: number
  expected_ref_files?: string[]
  // PageRank tests
  expected_top_symbols?: string[]
  // Confidence tests
  relation_type?: string
  min_confidence?: number
}

interface TestSuite {
  name: string
  project: string
  test_cases: TestCase[]
}

interface TestResult {
  name: string
  passed: boolean
  details: string
  expected?: unknown
  actual?: unknown
}

/**
 * Split a REPL line into argv tokens, honoring single/double quotes so that
 * multi-word arguments (e.g. apply "<new content>") survive intact.
 */
function tokenizeLine(line: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === ' ' || c === '\t') {
      if (cur) { tokens.push(cur); cur = '' }
    } else {
      cur += c
    }
  }
  if (cur) tokens.push(cur)
  return tokens
}

const DEBUG_HELP = `
CodeWiki 交互式调试器 (REPL)
  在这里可直接运行任意 CodeWiki 命令，无需每次重复 --project。
  当前项目会作为默认 -p 注入，未指定 -d 时自动带上当前深度。

会话命令:
  help | ?               显示本帮助
  project [<path>]       查看 / 设置当前项目路径
  depth [<n>]            查看 / 设置遍历深度
  info                   显示当前会话状态
  clear                  清屏
  exit | quit            退出调试器

常用调试命令 (示例):
  search <query>                 语义搜索
  entity <name>                  查看实体
  impact <name>                  影响分析 (爆炸半径)
  callers <name> / callees <name>  调用关系
  trace <from> <to>              两实体间调用路径
  context <query> --intent debug 为某问题构建完整上下文
  pre-check <name> "<desc>"      改动前安全分析
  status                         索引状态
`

/**
 * Interactive CLI debugger / REPL. Keeps a project + depth loaded across
 * commands and dispatches each entered line to the CLI itself in a child
 * process, so per-command `process.exit` calls don't tear down the session.
 */
function cmdDebug(initialProject: string, initialDepth: number): void {
  let project = initialProject
  let depth = initialDepth
  const cliEntry = process.argv[1]

  console.log(DEBUG_HELP)
  console.log(`  项目: ${path.resolve(project)}   深度: ${depth}\n`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'codewiki(debug)> ',
  })
  rl.prompt()

  rl.on('line', (raw) => {
    const line = raw.trim()
    if (!line) { rl.prompt(); return }
    const tokens = tokenizeLine(line)
    const head = tokens[0]
    const rest = tokens.slice(1)

    switch (head) {
      case 'exit': case 'quit': case ':q':
        rl.close(); return
      case 'help': case '?': case ':h':
        console.log(DEBUG_HELP); break
      case 'clear': case ':clear':
        console.clear(); break
      case 'info': case ':info':
        console.log(`  项目: ${path.resolve(project)}   深度: ${depth}`); break
      case 'project': case ':project': case 'p':
        if (rest[0]) { project = rest[0]; console.log(`  已切换项目 -> ${path.resolve(project)}`) }
        else console.log(`  当前项目: ${path.resolve(project)}`)
        break
      case 'depth': case ':depth':
        if (rest[0]) { const d = parseInt(rest[0], 10); if (d > 0) { depth = d; console.log(`  深度 -> ${depth}`) } else console.log('  无效深度') }
        else console.log(`  当前深度: ${depth}`)
        break
      default: {
        // Inject the session project/depth defaults when the user didn't pass them.
        const args = [...tokens]
        const hasProject = args.some(a => a === '-p' || a === '--project' || a.startsWith('--project=') || a.startsWith('-p='))
        const hasDepth = args.some(a => a === '-d' || a === '--depth' || a.startsWith('--depth=') || a.startsWith('-d='))
        if (!hasProject) args.push('-p', project)
        if (!hasDepth) args.push('-d', String(depth))
        try {
          // Run the compiled .js directly with node; in dev (.ts entry) go via ts-node.
          const isTs = cliEntry.endsWith('.ts')
          const cmd = isTs ? 'npx' : process.execPath
          const cmdArgs = isTs ? ['ts-node', cliEntry, ...args] : [cliEntry, ...args]
          const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' })
          if (res.error) console.error('  执行失败:', res.error.message)
        } catch (err) {
          console.error('  执行失败:', (err as Error).message)
        }
      }
    }
    rl.prompt()
  })

  rl.on('close', () => {
    console.log('\n再见 👋')
    process.exit(0)
  })
}

function cmdTest(suitePath: string, projectPath: string): void {
  const absPath = path.resolve(suitePath)

  // Allow direct JSON file path or directory containing test-suite.json
  let suiteFile: string
  let suiteDir: string
  if (absPath.endsWith('.json') && fs.existsSync(absPath)) {
    suiteFile = absPath
    suiteDir = path.dirname(absPath)
  } else {
    suiteFile = path.join(absPath, 'test-suite.json')
    suiteDir = absPath
    if (!fs.existsSync(suiteFile)) {
      console.error(`No test-suite.json found at ${absPath}`)
      console.log('Create a test-suite.json following the format in test-fixtures/')
      process.exit(1)
    }
  }

  const suite: TestSuite = JSON.parse(fs.readFileSync(suiteFile, 'utf-8'))
  const testProjectPath = path.resolve(suiteDir, suite.project || '.')

  console.log(`\n  CodeWiki Accuracy Test Suite: ${suite.name}`)
  console.log(`  Project: ${testProjectPath}`)
  console.log(`  ─────────────────────────────────────\n`)

  const { graph, fileContents } = buildOntology(testProjectPath)
  const docs = buildSearchDocs(fileContents, testProjectPath)

  const results: TestResult[] = []

  for (const tc of suite.test_cases) {
    let result: TestResult

    switch (tc.type) {
      case 'entity_extraction':
        result = testEntityExtraction(tc, graph)
        break
      case 'relation_detection':
        result = testRelationDetection(tc, graph)
        break
      case 'impact_analysis':
        result = testImpactAnalysis(tc, graph)
        break
      case 'search_relevance':
        result = testSearchRelevance(tc, docs)
        break
      case 'validate_safety':
        result = testValidateSafety(tc, graph)
        break
      case 'callers':
        result = testCallers(tc, graph)
        break
      case 'callees':
        result = testCallees(tc, graph)
        break
      case 'blast_radius':
        result = testBlastRadius(tc, graph)
        break
      case 'dead_code':
        result = testDeadCode(tc, graph)
        break
      case 'find_references':
        result = testFindReferences(tc, graph, fileContents, testProjectPath)
        break
      case 'pagerank':
        result = testPageRank(tc, graph)
        break
      case 'confidence':
        result = testConfidence(tc, graph)
        break
      default:
        result = { name: tc.name, passed: false, details: `Unknown test type: ${tc.type}` }
    }

    results.push(result)
    const status = result.passed ? 'PASS' : 'FAIL'
    const marker = result.passed ? '✓' : '✗'
    console.log(`  ${marker} [${status}] ${result.name}`)
    if (!result.passed) {
      console.log(`           ${result.details}`)
      if (result.expected) console.log(`           Expected: ${JSON.stringify(result.expected)}`)
      if (result.actual) console.log(`           Actual:   ${JSON.stringify(result.actual)}`)
    }
  }

  const passed = results.filter(r => r.passed).length
  const total = results.length
  const pct = total > 0 ? ((passed / total) * 100).toFixed(0) : '0'

  console.log(`\n  ─────────────────────────────────────`)
  console.log(`  Results: ${passed}/${total} passed (${pct}%)`)
  console.log(`  Accuracy Score: ${pct}%\n`)

  if (isJson) {
    output({ command: 'test', suite: suite.name, passed, total, percentage: Number(pct), results })
  }

  process.exit(passed === total ? 0 : 1)
}

function testEntityExtraction(tc: TestCase, graph: OntologyGraph): TestResult {
  if (!tc.expected_entities) return { name: tc.name, passed: false, details: 'No expected_entities defined' }

  const missing: string[] = []
  for (const expected of tc.expected_entities) {
    const found = graph.entities.find(e =>
      e.name === expected.name &&
      e.type.toLowerCase() === expected.type.toLowerCase() &&
      (!expected.file || e.filePath.includes(expected.file))
    )
    if (!found) missing.push(`${expected.type}:${expected.name}`)
  }

  return {
    name: tc.name,
    passed: missing.length === 0,
    details: missing.length > 0 ? `Missing entities: ${missing.join(', ')}` : 'All entities found',
    expected: tc.expected_entities.map(e => `${e.type}:${e.name}`),
    actual: missing.length > 0 ? `Missing: ${missing.join(', ')}` : undefined,
  }
}

function testRelationDetection(tc: TestCase, graph: OntologyGraph): TestResult {
  if (!tc.expected_relations) return { name: tc.name, passed: false, details: 'No expected_relations defined' }

  const missing: string[] = []
  for (const expected of tc.expected_relations) {
    const found = graph.relations.find(r => {
      const src = graph.entities.find(e => e.id === r.source)
      const tgt = graph.entities.find(e => e.id === r.target)
      return src?.name === expected.source && tgt?.name === expected.target && r.type === expected.type
    })
    if (!found) missing.push(`${expected.source} -${expected.type}-> ${expected.target}`)
  }

  return {
    name: tc.name,
    passed: missing.length === 0,
    details: missing.length > 0 ? `Missing relations: ${missing.join(', ')}` : 'All relations found',
  }
}

function testImpactAnalysis(tc: TestCase, graph: OntologyGraph): TestResult {
  if (!tc.modify_entity) return { name: tc.name, passed: false, details: 'No modify_entity defined' }

  const entity = graph.entities.find(e => e.name === tc.modify_entity)
  if (!entity) return { name: tc.name, passed: false, details: `Entity "${tc.modify_entity}" not found in graph` }

  const impacted = getImpactedEntities(entity.id, graph, 3)
  const impactedNames = new Set(
    graph.entities.filter(e => impacted.has(e.id)).map(e => e.name)
  )

  const missingExpected = (tc.expected_impacted || []).filter(n => !impactedNames.has(n))
  const falsePositives = (tc.not_impacted || []).filter(n => impactedNames.has(n))

  const passed = missingExpected.length === 0 && falsePositives.length === 0
  const details: string[] = []
  if (missingExpected.length > 0) details.push(`Missing from impact: ${missingExpected.join(', ')}`)
  if (falsePositives.length > 0) details.push(`Should not be impacted: ${falsePositives.join(', ')}`)

  return {
    name: tc.name,
    passed,
    details: passed ? 'Impact analysis correct' : details.join('; '),
  }
}

function testSearchRelevance(tc: TestCase, docs: Doc[]): TestResult {
  if (!tc.query || !tc.expected_top3) return { name: tc.name, passed: false, details: 'No query or expected_top3' }

  const results = tfidfSearch(docs, tc.query, 5)
  const top3Files = results.slice(0, 3).map(r => r.filePath)

  const hits = tc.expected_top3.filter(f => top3Files.some(t => t.includes(f)))
  const passed = hits.length >= Math.ceil(tc.expected_top3.length * 0.5) // At least 50% in top 3

  return {
    name: tc.name,
    passed,
    details: `${hits.length}/${tc.expected_top3.length} expected files in top 3`,
    expected: tc.expected_top3,
    actual: top3Files,
  }
}

function testValidateSafety(tc: TestCase, graph: OntologyGraph): TestResult {
  if (!tc.validate_file || !tc.validate_range) return { name: tc.name, passed: false, details: 'No validate_file or validate_range' }

  const affectedEntities = graph.entities.filter(e =>
    e.filePath.includes(tc.validate_file!) &&
    e.line <= tc.validate_range![1] && e.endLine >= tc.validate_range![0]
  )

  const hasEntities = affectedEntities.length > 0
  const allImpacted = new Set<string>()
  for (const e of affectedEntities) {
    const imp = getImpactedEntities(e.id, graph, 2)
    for (const id of imp) allImpacted.add(id)
  }
  const impactedFiles = [...new Set(graph.entities.filter(e => allImpacted.has(e.id)).map(e => e.filePath))]
  const hasWarning = impactedFiles.length > 5

  const passed = tc.should_warn ? hasWarning : !hasWarning

  return {
    name: tc.name,
    passed,
    details: `Affected: ${affectedEntities.length} entities, ${impactedFiles.length} files. Warning: ${hasWarning}`,
  }
}

function testCallers(tc: TestCase, graph: OntologyGraph): TestResult {
  if (!tc.entity) return { name: tc.name, passed: false, details: 'No entity specified' }
  const entity = graph.entities.find(e => e.name === tc.entity && e.type !== 'File')
  if (!entity) return { name: tc.name, passed: false, details: `Entity "${tc.entity}" not found` }

  const callers: string[] = []
  const visited = new Set<string>()
  const queue = [{ id: entity.id, d: 0 }]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.d > 3 || visited.has(cur.id)) continue
    visited.add(cur.id)
    for (const r of graph.relations) {
      if (r.type === 'calls' && r.target === cur.id && !visited.has(r.source)) {
        const caller = graph.entities.find(e => e.id === r.source)
        if (caller) { callers.push(caller.name); queue.push({ id: caller.id, d: cur.d + 1 }) }
      }
    }
  }

  const expectedCallers = tc.expected_callers || []
  const missing = expectedCallers.filter(c => !callers.includes(c))
  const passed = missing.length === 0
  return {
    name: tc.name,
    passed,
    details: passed ? `Found ${callers.length} callers` : `Missing callers: ${missing.join(', ')}`,
    expected: expectedCallers,
    actual: callers,
  }
}

function testCallees(tc: TestCase, graph: OntologyGraph): TestResult {
  if (!tc.entity) return { name: tc.name, passed: false, details: 'No entity specified' }
  const entity = graph.entities.find(e => e.name === tc.entity && e.type !== 'File')
  if (!entity) return { name: tc.name, passed: false, details: `Entity "${tc.entity}" not found` }

  const callees: string[] = []
  for (const r of graph.relations) {
    if (r.type === 'calls' && r.source === entity.id) {
      const callee = graph.entities.find(e => e.id === r.target)
      if (callee) callees.push(callee.name)
    }
  }

  const expectedCallees = tc.expected_callees || []
  const missing = expectedCallees.filter(c => !callees.includes(c))
  const passed = missing.length === 0
  return {
    name: tc.name,
    passed,
    details: passed ? `Found ${callees.length} callees` : `Missing callees: ${missing.join(', ')}`,
    expected: expectedCallees,
    actual: callees,
  }
}

function testBlastRadius(tc: TestCase, graph: OntologyGraph): TestResult {
  if (!tc.entity) return { name: tc.name, passed: false, details: 'No entity specified' }
  const entity = graph.entities.find(e => e.name === tc.entity && e.type !== 'File')
  if (!entity) return { name: tc.name, passed: false, details: `Entity "${tc.entity}" not found` }

  // Include the entity's own methods as starting points
  const seeds = [entity.id]
  for (const r of graph.relations) {
    if (r.source === entity.id && r.type === 'contains') seeds.push(r.target)
  }

  const dependents = new Set<string>()
  const queue = seeds.map(id => ({ id, d: 0 }))
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.d > 3 || dependents.has(cur.id)) continue
    dependents.add(cur.id)
    for (const r of graph.relations) {
      if (r.target === cur.id && !dependents.has(r.source) && r.type !== 'contains') {
        queue.push({ id: r.source, d: cur.d + 1 })
      }
    }
  }
  // Remove self and own methods
  for (const s of seeds) dependents.delete(s)

  const depEntities = graph.entities.filter(e => dependents.has(e.id))
  const byFile = new Set(depEntities.map(e => e.filePath))
  let risk = 'low'
  if (depEntities.length > 30 || byFile.size > 10) risk = 'critical'
  else if (depEntities.length > 15 || byFile.size > 5) risk = 'high'
  else if (depEntities.length > 5 || byFile.size > 2) risk = 'medium'

  let passed = true
  if (tc.min_dependents !== undefined && depEntities.length < tc.min_dependents) passed = false
  if (tc.expected_risk && risk !== tc.expected_risk) passed = false

  return {
    name: tc.name,
    passed,
    details: `Risk: ${risk}, Dependents: ${depEntities.length}, Files: ${byFile.size}`,
    expected: { risk: tc.expected_risk, minDependents: tc.min_dependents },
    actual: { risk, dependents: depEntities.length, files: byFile.size },
  }
}

function testDeadCode(tc: TestCase, graph: OntologyGraph): TestResult {
  const deadNames: string[] = []
  for (const entity of graph.entities) {
    if (entity.type === 'File') continue
    const incoming = graph.relations.filter(r => r.target === entity.id && r.type !== 'contains')
    const outContains = graph.relations.filter(r => r.source === entity.id && r.type === 'contains')
    if (outContains.length > 0 && entity.type === 'Class') continue
    if (incoming.length === 0) {
      const isTest = entity.filePath.includes('test') || entity.filePath.includes('spec')
      const isEntry = entity.name === 'main' || entity.name === 'default' || entity.filePath.includes('index.') || entity.filePath.includes('app.')
      if (!isTest && !isEntry) deadNames.push(entity.name)
    }
  }

  let passed = true
  const expectedDead = tc.expected_dead || []
  const notDead = tc.not_dead || []
  const missingDead = expectedDead.filter(d => !deadNames.includes(d))
  const falsePositives = notDead.filter(d => deadNames.includes(d))
  if (missingDead.length > 0) passed = false
  if (falsePositives.length > 0) passed = false

  return {
    name: tc.name,
    passed,
    details: passed
      ? `Detected ${deadNames.length} dead symbols correctly`
      : `Missing dead: ${missingDead.join(', ')}. False positives: ${falsePositives.join(', ')}`,
    expected: { dead: expectedDead, notDead },
    actual: deadNames,
  }
}

function testFindReferences(tc: TestCase, graph: OntologyGraph, fileContents: Map<string, string>, projectPath: string): TestResult {
  if (!tc.entity) return { name: tc.name, passed: false, details: 'No entity specified' }
  const entity = graph.entities.find(e => e.name === tc.entity && e.type !== 'File')
  if (!entity) return { name: tc.name, passed: false, details: `Entity "${tc.entity}" not found` }

  // Graph refs
  const graphRefCount = graph.relations.filter(r => r.target === entity.id && r.type !== 'contains').length

  // Text refs
  const nameRegex = new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
  const refFiles = new Set<string>()
  for (const [fp, content] of fileContents) {
    const relPath = path.relative(projectPath, fp).replace(/\\/g, '/')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (relPath === entity.filePath.replace(/\\/g, '/') && i + 1 === entity.line) continue
      if (nameRegex.test(lines[i])) refFiles.add(relPath)
      nameRegex.lastIndex = 0
    }
  }

  let passed = true
  const totalRefs = graphRefCount + refFiles.size
  if (tc.min_refs !== undefined && totalRefs < tc.min_refs) passed = false
  if (tc.expected_ref_files) {
    const missing = tc.expected_ref_files.filter(f => !Array.from(refFiles).some(rf => rf.includes(f)))
    if (missing.length > 0) passed = false
  }

  return {
    name: tc.name,
    passed,
    details: `Graph refs: ${graphRefCount}, Text ref files: ${refFiles.size}, Total: ${totalRefs}`,
    expected: { minRefs: tc.min_refs, files: tc.expected_ref_files },
    actual: { graphRefs: graphRefCount, textRefFiles: Array.from(refFiles) },
  }
}

function testPageRank(tc: TestCase, graph: OntologyGraph): TestResult {
  const entities = graph.entities.filter(e => e.type !== 'File')
  const entityMap = new Map(entities.map(e => [e.id, e]))
  const outLinks = new Map<string, string[]>()
  const inLinks = new Map<string, string[]>()
  for (const e of entities) { outLinks.set(e.id, []); inLinks.set(e.id, []) }
  for (const r of graph.relations) {
    if (r.type === 'contains' || !entityMap.has(r.source) || !entityMap.has(r.target)) continue
    outLinks.get(r.source)?.push(r.target)
    inLinks.get(r.target)?.push(r.source)
  }
  const n = entities.length
  let ranks = new Map<string, number>()
  for (const e of entities) ranks.set(e.id, 1 / n)
  for (let iter = 0; iter < 20; iter++) {
    const newR = new Map<string, number>()
    for (const e of entities) {
      let sum = 0
      for (const src of (inLinks.get(e.id) || [])) sum += (ranks.get(src) || 0) / (outLinks.get(src)?.length || 1)
      newR.set(e.id, 0.15 / n + 0.85 * sum)
    }
    ranks = newR
  }
  const topSymbols = entities.map(e => ({ name: e.name, rank: ranks.get(e.id) || 0 }))
    .sort((a, b) => b.rank - a.rank).slice(0, 10).map(s => s.name)

  const expectedTop = tc.expected_top_symbols || []
  const found = expectedTop.filter(s => topSymbols.includes(s))
  const passed = found.length === expectedTop.length

  return {
    name: tc.name,
    passed,
    details: passed ? `Top symbols: ${topSymbols.slice(0, 5).join(', ')}` : `Missing from top 10: ${expectedTop.filter(s => !topSymbols.includes(s)).join(', ')}`,
    expected: expectedTop,
    actual: topSymbols,
  }
}

function testConfidence(tc: TestCase, graph: OntologyGraph): TestResult {
  addConfidenceScores(graph)
  const relType = tc.relation_type || 'calls'
  const minConf = tc.min_confidence || 0.5
  const rels = graph.relations.filter(r => r.type === relType)

  if (rels.length === 0) return { name: tc.name, passed: false, details: `No relations of type "${relType}" found` }

  const withConfidence = rels.filter(r => r.confidence !== undefined)
  const aboveThreshold = rels.filter(r => (r.confidence || 0) >= minConf)
  const passed = withConfidence.length === rels.length && aboveThreshold.length > 0

  return {
    name: tc.name,
    passed,
    details: `${withConfidence.length}/${rels.length} have confidence scores. ${aboveThreshold.length} above ${minConf}`,
  }
}

main()
