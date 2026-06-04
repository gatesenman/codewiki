#!/usr/bin/env node
/**
 * Standalone MCP Server for CodeWiki
 *
 * Provides ontology-based code knowledge tools over the MCP stdio transport.
 *
 * Usage:
 *   PROJECT_PATH=/path/to/project node dist/server/mcp-server.js
 *
 * MCP client config (Claude Desktop, Cursor, etc.):
 *   {
 *     "mcpServers": {
 *       "codewiki": {
 *         "command": "node",
 *         "args": ["path/to/codewiki/dist/server/mcp-server.js"],
 *         "env": { "PROJECT_PATH": "/path/to/your/project" }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ---- Shared call log (same JSONL as the CLI / serve dashboard) ----

interface McpCallLogEntry {
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

function callLogDir(): string {
  return process.env.CODEWIKI_LOG_DIR || path.join(os.homedir(), '.codewiki')
}

function appendMcpCallLog(entry: McpCallLogEntry): void {
  try {
    const dir = callLogDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'call-log.jsonl'), JSON.stringify(entry) + '\n', 'utf-8')
  } catch { /* logging must never break a tool call */ }
}

// Heuristic accuracy score for an MCP tool result (0-1), mirroring the CLI scorer.
function scoreMcpResult(tool: string, isError: boolean, text: string): number {
  if (isError) return 0
  const t = text || ''
  if (/^no results|^no direct|unknown tool|not found/i.test(t.trim())) return 0.4
  switch (tool) {
    case 'pre_check':
    case 'get_edit_context':
      return /risk|caller|impact/i.test(t) ? 0.9 : 0.6
    case 'find_callers':
    case 'find_callees':
    case 'find_references':
      return /result|→|:\d+|`/.test(t) ? 0.9 : 0.5
    case 'blast_radius':
      return /risk|dependent/i.test(t) ? 0.9 : 0.6
    case 'search_code':
      return /result/i.test(t) ? 0.85 : 0.4
    default:
      return t.length > 20 ? 0.85 : 0.6
  }
}

// ---- Lightweight inline re-implementations (no browser APIs) ----

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
}

interface OntologyGraph {
  entities: OntologyEntity[]
  relations: OntologyRelation[]
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.pytest_cache', '.mypy_cache',
  'target', 'bin', 'obj', '.idea', '.vscode', '.vs', 'coverage',
  '.turbo', '.cache', 'tmp', 'temp',
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue',
  '.svelte', '.md', '.json', '.yaml', '.yml', '.toml',
])

function readDirectoryRecursive(dirPath: string, basePath: string, depth: number): FileNode[] {
  if (depth > 8) return []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
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
      if (CODE_EXTENSIONS.has(ext) || entry.name === 'Makefile' || entry.name === 'Dockerfile') {
        const stats = fs.statSync(fullPath)
        if (stats.size < 500_000) {
          nodes.push({ name: entry.name, path: fullPath, relativePath, type: 'file', extension: ext })
        }
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

// ---- Minimal inline ontology builder ----

let nextId = 0
function uid() { return `e${++nextId}` }

function buildOntology(projectPath: string): { graph: OntologyGraph; fileContents: Map<string, string> } {
  const tree = readDirectoryRecursive(projectPath, projectPath, 0)
  const flat = flattenFiles(tree).filter(f => f.type === 'file')

  const entities: OntologyEntity[] = []
  const relations: OntologyRelation[] = []
  const fileModuleMap = new Map<string, string>()
  const fileContents = new Map<string, string>()

  for (const file of flat) {
    let content: string
    try { content = fs.readFileSync(file.path, 'utf-8') } catch { continue }
    fileContents.set(file.path, content)

    const moduleId = uid()
    entities.push({ id: moduleId, name: file.name, type: 'File', filePath: file.relativePath, line: 1, endLine: content.split('\n').length })
    fileModuleMap.set(file.path, moduleId)

    const patterns: Array<{ regex: RegExp; type: string }> = [
      { regex: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g, type: 'Class' },
      { regex: /(?:export\s+)?interface\s+(\w+)/g, type: 'Interface' },
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, type: 'Function' },
      { regex: /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?:=>|:)/g, type: 'Function' },
      { regex: /def\s+(\w+)/g, type: 'Function' },
      { regex: /(?:export\s+)?type\s+(\w+)/g, type: 'Type' },
      { regex: /(?:export\s+)?enum\s+(\w+)/g, type: 'Enum' },
    ]

    for (const { regex, type } of patterns) {
      let m
      while ((m = regex.exec(content)) !== null) {
        const line = content.substring(0, m.index).split('\n').length
        const eid = uid()
        entities.push({ id: eid, name: m[1], type, filePath: file.relativePath, line, endLine: line + 20, signature: m[0].trim() })
        relations.push({ id: uid(), source: moduleId, target: eid, type: 'contains' })
      }
    }
  }

  return { graph: { entities, relations }, fileContents }
}

// ---- TF-IDF search (minimal) ----

interface Doc { id: string; content: string; filePath: string }

function tfidfSearch(docs: Doc[], query: string, topK: number): Array<{ filePath: string; content: string; score: number }> {
  const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter(t => t.length > 1)
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
      if (docTokenSets[i].has(qt)) {
        score += Math.log(1 + N / (df.get(qt) || 1))
      }
    }
    return { filePath: d.filePath, content: d.content.substring(0, 500), score }
  })

  return scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topK)
}

// ---- BFS impact analysis ----

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

// ---- Incremental indexing ----

interface FileHash {
  path: string
  mtime: number
  size: number
}

function getFileHashes(projectPath: string): Map<string, FileHash> {
  const tree = readDirectoryRecursive(projectPath, projectPath, 0)
  const flat = flattenFiles(tree).filter(f => f.type === 'file')
  const hashes = new Map<string, FileHash>()
  for (const file of flat) {
    try {
      const stats = fs.statSync(file.path)
      hashes.set(file.path, { path: file.path, mtime: stats.mtimeMs, size: stats.size })
    } catch { /* skip */ }
  }
  return hashes
}

function detectChanges(oldHashes: Map<string, FileHash>, newHashes: Map<string, FileHash>): {
  added: string[]
  modified: string[]
  removed: string[]
} {
  const added: string[] = []
  const modified: string[] = []
  const removed: string[] = []

  for (const [path, hash] of newHashes) {
    const old = oldHashes.get(path)
    if (!old) { added.push(path) }
    else if (old.mtime !== hash.mtime || old.size !== hash.size) { modified.push(path) }
  }
  for (const path of oldHashes.keys()) {
    if (!newHashes.has(path)) { removed.push(path) }
  }

  return { added, modified, removed }
}

// ---- Main ----

async function main() {
  const projectPath = process.env.PROJECT_PATH
  if (!projectPath || !fs.existsSync(projectPath)) {
    process.stderr.write(`Error: PROJECT_PATH="${projectPath || ''}" does not exist.\n`)
    process.exit(1)
  }

  process.stderr.write(`CodeWiki MCP Server: indexing ${projectPath}...\n`)
  let { graph, fileContents } = buildOntology(projectPath)
  let docs: Doc[] = Array.from(fileContents.entries()).map(([p, c]) => ({
    id: p, content: c.substring(0, 8000), filePath: path.relative(projectPath, p),
  }))
  let fileHashes = getFileHashes(projectPath)
  let lastIndexTime = Date.now()
  process.stderr.write(`Indexed ${graph.entities.length} entities, ${docs.length} files.\n`)

  const server = new Server({ name: 'codewiki', version: '1.0.0' }, { capabilities: { tools: {} } })

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'read_wiki',
        description: 'Get a summary of the project structure and key entities.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'search_code',
        description: 'Semantic search across the codebase. Returns relevant code snippets ranked by relevance.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
            limit: { type: 'number', description: 'Max results (default 5)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_entity_info',
        description: 'Get info about a code entity (class, function, interface) from the ontology graph.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Entity name' },
            type: { type: 'string', description: 'Optional entity type filter (Class, Function, etc.)' },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_dependencies',
        description: 'Get the dependency graph for a code entity.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name' },
            depth: { type: 'number', description: 'Depth (default 2)' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'get_impact_analysis',
        description: 'Analyze what would be affected by modifying a code entity. Critical for preventing hallucination.',
        inputSchema: {
          type: 'object' as const,
          properties: { entity: { type: 'string', description: 'Entity name' } },
          required: ['entity'],
        },
      },
      {
        name: 'pre_check',
        description: 'Comprehensive pre-modification analysis. Run this BEFORE modifying any code entity. Returns current source, relations, impact scope, siblings, warnings, and risk recommendation.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name or file path to check' },
            description: { type: 'string', description: 'What modification you plan to make (for context search)' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'verify_modification',
        description: 'Post-modification verification. Run this AFTER modifying a file to check for syntax errors, removed entities, and broken dependencies.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            file: { type: 'string', description: 'File path (relative to project root)' },
          },
          required: ['file'],
        },
      },
      {
        name: 'health_check',
        description: 'Check CodeWiki MCP server health and configuration. Returns project path, index stats, and capabilities.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'get_relations',
        description: 'Get all incoming and outgoing relations for a code entity. Useful for understanding how an entity connects to others.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'find_callers',
        description: 'Find all entities that call a given symbol. Essential for understanding usage before modifying code.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name to find callers of' },
            depth: { type: 'number', description: 'BFS depth for transitive callers (default 3)' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'find_callees',
        description: 'Find all entities called by a given symbol. Shows what a function depends on.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name to find callees of' },
            depth: { type: 'number', description: 'BFS depth for transitive callees (default 3)' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'trace_path',
        description: 'Trace the call path between two symbols. Shows how entity A reaches entity B through calls/uses/imports.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from: { type: 'string', description: 'Source entity name' },
            to: { type: 'string', description: 'Target entity name' },
            depth: { type: 'number', description: 'Max path length (default 5)' },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'blast_radius',
        description: 'Analyze the blast radius of modifying an entity. Reverse BFS to find all upstream dependents — everything that would break if this entity changes.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name to analyze' },
            depth: { type: 'number', description: 'BFS depth (default 3)' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'get_context',
        description: 'Smart context builder. One tool call returns source code, callers, callees, relations, and impact count for entities matching a query. Use this as your primary context-gathering tool before any code task.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Natural language query or entity name' },
            intent: { type: 'string', description: 'Intent: explain | modify | debug | test (default: explain)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_edit_context',
        description: 'Pre-edit context: returns source, all callers with their source, all callees, related tests, siblings, forward impact, and blast radius. Run this BEFORE editing any entity.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name to get edit context for' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'explore_symbols',
        description: 'Return source code for multiple symbols, grouped by file, plus the relationship map between them. Useful for understanding how a group of entities work together.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entities: { type: 'string', description: 'Comma-separated entity names' },
          },
          required: ['entities'],
        },
      },
      {
        name: 'file_context',
        description: 'Get all symbols defined in a file plus its imports and exports. Useful for understanding a file before editing.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            file: { type: 'string', description: 'File path (relative to project root)' },
          },
          required: ['file'],
        },
      },
      {
        name: 'analyze_complexity',
        description: 'Analyze the cyclomatic complexity and coupling metrics of an entity.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name to analyze' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'find_dead_code',
        description: 'Find unreferenced symbols (dead code). Returns orphan functions, exported-but-unused symbols, and internal-unused code grouped by file.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'find_references',
        description: 'Find all usage sites of a symbol across the codebase. Returns both graph-based references (callers, importers) and text-based matches.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            entity: { type: 'string', description: 'Entity name to find references of' },
          },
          required: ['entity'],
        },
      },
      {
        name: 'get_key_symbols',
        description: 'Rank symbols by structural importance using PageRank on the code graph. Identifies the most connected and depended-upon symbols.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            top: { type: 'number', description: 'Number of top symbols to return (default 15)' },
          },
        },
      },
      {
        name: 'trace_route',
        description: 'Trace HTTP request flow from route path to handler to downstream service calls. Supports Express, Flask/FastAPI, Go net/http patterns.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            route: { type: 'string', description: 'Route path to trace (e.g., /api/users)' },
            depth: { type: 'number', description: 'Max trace depth (default 5)' },
          },
          required: ['route'],
        },
      },
      {
        name: 'lsif_status',
        description: 'Check if LSIF/SCIP index is available. Shows how to generate one for compiler-accurate code intelligence.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'incremental_reindex',
        description: 'Incrementally reindex the project — only processes files that have changed since last index. Much faster than full reindex for large projects.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'full_reindex',
        description: 'Force a full reindex of the entire project. Use when incremental reindex is not sufficient.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'get_architecture',
        description: 'Architecture overview: languages, entry points, hotspots (most-depended symbols), layers, cross-boundary dependencies. One call to understand the entire codebase structure.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'detect_changes',
        description: 'Map uncommitted git changes to affected symbols with risk classification. Shows which entities are impacted by current modifications.',
        inputSchema: {
          type: 'object' as const,
          properties: { depth: { type: 'number', description: 'BFS traversal depth (default 3)' } },
        },
      },
      {
        name: 'detect_communities',
        description: 'Community/cluster detection: groups related symbols into functional modules using connected-component analysis with cohesion scoring.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'suggest_tests',
        description: 'Given a modified entity, suggest which test files to run — both direct tests and transitive dependent tests.',
        inputSchema: {
          type: 'object' as const,
          properties: { entity: { type: 'string', description: 'Entity name to find relevant tests for' } },
          required: ['entity'],
        },
      },
    ],
  }))

  // Handle tool calls
  type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

  const runTool = async (request: { params: { name: string; arguments?: Record<string, unknown> } }): Promise<ToolResult> => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'read_wiki': {
          const classes = graph.entities.filter(e => e.type === 'Class')
          const funcs = graph.entities.filter(e => e.type === 'Function')
          const files = graph.entities.filter(e => e.type === 'File')
          const text = [
            `# Project: ${path.basename(projectPath)}`,
            `**${files.length}** files, **${classes.length}** classes, **${funcs.length}** functions, **${graph.relations.length}** relations`,
            '',
            '## Key Classes',
            ...classes.slice(0, 20).map(c => `- **${c.name}** (${c.filePath}:${c.line})`),
            '',
            '## Key Functions',
            ...funcs.slice(0, 20).map(f => `- **${f.name}** (${f.filePath}:${f.line})`),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'search_code': {
          const query = String(args?.query || '')
          const limit = Number(args?.limit) || 5
          const results = tfidfSearch(docs, query, limit)
          if (results.length === 0) return { content: [{ type: 'text', text: `No results for "${query}"` }] }
          const text = results.map((r, i) =>
            `### Result ${i + 1} (score: ${r.score.toFixed(2)})\n**File**: ${r.filePath}\n\`\`\`\n${r.content}\n\`\`\``
          ).join('\n\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'get_entity_info': {
          const nameQ = String(args?.name || '').toLowerCase()
          const typeQ = args?.type ? String(args.type).toLowerCase() : null
          let matches = graph.entities.filter(e => e.name.toLowerCase().includes(nameQ))
          if (typeQ) matches = matches.filter(e => e.type.toLowerCase() === typeQ)
          if (matches.length === 0) return { content: [{ type: 'text', text: `No entity matching "${args?.name}"` }] }
          const text = matches.slice(0, 10).map(e => {
            const rels = graph.relations.filter(r => r.source === e.id || r.target === e.id)
            return `## ${e.type}: ${e.name}\n**File**: ${e.filePath}:${e.line}\n${e.signature ? `**Signature**: \`${e.signature}\`\n` : ''}**Relations** (${rels.length}):\n${rels.slice(0, 10).map(r => {
              const other = graph.entities.find(o => o.id === (r.source === e.id ? r.target : r.source))
              return `  ${r.source === e.id ? '->' : '<-'} ${r.type} ${other?.name || '?'} (${other?.type})`
            }).join('\n')}`
          }).join('\n\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'get_dependencies': {
          const eName = String(args?.entity || '').toLowerCase()
          const depth = Number(args?.depth) || 2
          const entity = graph.entities.find(e => e.name.toLowerCase() === eName)
          if (!entity) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found.` }] }
          const deps: string[] = []
          const visited = new Set<string>()
          const traverse = (id: string, d: number, prefix: string) => {
            if (d > depth || visited.has(id)) return
            visited.add(id)
            for (const r of graph.relations.filter(rel => rel.source === id)) {
              const t = graph.entities.find(e => e.id === r.target)
              if (t) { deps.push(`${prefix}${r.type} -> ${t.type}:${t.name} (${t.filePath}:${t.line})`); traverse(r.target, d + 1, prefix + '  ') }
            }
          }
          traverse(entity.id, 0, '')
          return { content: [{ type: 'text', text: `# Dependencies: ${entity.type} ${entity.name}\n\n${deps.join('\n') || 'No dependencies.'}` }] }
        }

        case 'get_impact_analysis': {
          const eName = String(args?.entity || '').toLowerCase()
          const entity = graph.entities.find(e => e.name.toLowerCase() === eName)
          if (!entity) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found.` }] }
          const impacted = getImpactedEntities(entity.id, graph, 3)
          const impactedEnts = graph.entities.filter(e => impacted.has(e.id) && e.id !== entity.id)
          const byFile = new Map<string, typeof impactedEnts>()
          for (const e of impactedEnts) { const l = byFile.get(e.filePath) || []; l.push(e); byFile.set(e.filePath, l) }
          const text = [
            `# Impact Analysis: ${entity.type} ${entity.name}`,
            `**File**: ${entity.filePath}:${entity.line}`,
            `**Impacted entities**: ${impactedEnts.length}`,
            `**Impacted files**: ${byFile.size}`,
            '',
            ...Array.from(byFile.entries()).map(([f, ents]) =>
              `## ${f}\n${ents.map(e => `- ${e.type}: ${e.name} (line ${e.line})`).join('\n')}`
            ),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'pre_check': {
          const entityName = String(args?.entity || '').toLowerCase()
          const description = String(args?.description || '')
          const entity = graph.entities.find(e => e.name.toLowerCase() === entityName)
          const fileEntity = graph.entities.find(e => e.type === 'File' && e.filePath.toLowerCase().includes(entityName))
          const target = entity || fileEntity
          if (!target) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found.` }] }

          // Relations
          const rels = graph.relations.filter(r => r.source === target.id || r.target === target.id)
          const relText = rels.map(r => {
            const other = graph.entities.find(e => e.id === (r.source === target.id ? r.target : r.source))
            return `  ${r.source === target.id ? '->' : '<-'} ${r.type} ${other?.name || '?'} (${other?.type})`
          }).join('\n')

          // Source code
          let source = ''
          if (target.type !== 'File') {
            const fullPath = path.join(projectPath, target.filePath)
            if (fs.existsSync(fullPath)) {
              const lines = fs.readFileSync(fullPath, 'utf-8').split('\n')
              source = lines.slice(target.line - 1, target.endLine).join('\n').substring(0, 3000)
            }
          }

          // Impact
          const impacted = getImpactedEntities(target.id, graph, 3)
          const impactedEnts = graph.entities.filter(e => impacted.has(e.id) && e.id !== target.id)
          const impactedFiles = [...new Set(impactedEnts.map(e => e.filePath))]

          // Siblings
          const siblings = graph.entities.filter(e => e.filePath === target.filePath && e.id !== target.id && e.type !== 'File')

          // Search context
          const searchResults = description ? tfidfSearch(docs, description, 3) : []

          // Warnings
          const warnings: string[] = []
          if (impactedEnts.length > 20) warnings.push(`High impact: ${impactedEnts.length} entities affected`)
          if (impactedFiles.length > 8) warnings.push(`Wide impact: ${impactedFiles.length} files affected`)

          const risk = warnings.length === 0 ? 'LOW' : warnings.length <= 2 ? 'MEDIUM' : 'HIGH'

          const text = [
            `# Pre-Check: ${target.type} ${target.name}`,
            `**File**: ${target.filePath}:${target.line}-${target.endLine}`,
            `**Risk**: ${risk}`,
            warnings.length > 0 ? `**Warnings**: ${warnings.join('; ')}` : '',
            '',
            source ? `## Current Source\n\`\`\`\n${source}\n\`\`\`\n` : '',
            `## Relations (${rels.length})\n${relText || 'None'}`,
            '',
            `## Siblings in File (${siblings.length})\n${siblings.map(s => `- ${s.type}: ${s.name} (line ${s.line})`).join('\n') || 'None'}`,
            '',
            `## Impact Scope\n**${impactedEnts.length} entities** across **${impactedFiles.length} files**`,
            impactedFiles.map(f => `- ${f}`).join('\n'),
            searchResults.length > 0 ? `\n## Related Code\n${searchResults.map(r => `- ${r.filePath} (score: ${r.score.toFixed(2)})`).join('\n')}` : '',
          ].filter(Boolean).join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'verify_modification': {
          const filePath = String(args?.file || '')
          const absFile = path.join(projectPath, filePath)
          if (!fs.existsSync(absFile)) return { content: [{ type: 'text', text: `File not found: ${filePath}` }], isError: true }

          const content = fs.readFileSync(absFile, 'utf-8')
          const lines = content.split('\n')
          const issues: string[] = []

          // Balanced delimiters check
          let braceCount = 0, parenCount = 0, bracketCount = 0
          let inStr = false, strCh = '', inBlockComment = false
          for (const line of lines) {
            for (let j = 0; j < line.length; j++) {
              const ch = line[j], next = j + 1 < line.length ? line[j + 1] : '', prev = j > 0 ? line[j - 1] : ''
              if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; j++ }; continue }
              if (ch === '/' && next === '/') break
              if (ch === '/' && next === '*') { inBlockComment = true; j++; continue }
              if (inStr) { if (ch === strCh && prev !== '\\') inStr = false; continue }
              if (ch === "'" || ch === '"' || ch === '`') { inStr = true; strCh = ch; continue }
              if (ch === '{') braceCount++; if (ch === '}') braceCount--
              if (ch === '(') parenCount++; if (ch === ')') parenCount--
              if (ch === '[') bracketCount++; if (ch === ']') bracketCount--
            }
          }

          if (braceCount !== 0) issues.push(`Unbalanced braces: ${braceCount > 0 ? braceCount + ' unclosed' : -braceCount + ' extra closing'}`)
          if (parenCount !== 0) issues.push(`Unbalanced parens: ${parenCount > 0 ? parenCount + ' unclosed' : -parenCount + ' extra closing'}`)
          if (bracketCount !== 0) issues.push(`Unbalanced brackets: ${bracketCount > 0 ? bracketCount + ' unclosed' : -bracketCount + ' extra closing'}`)

          // Check entities before/after
          const cachedEntities = graph.entities.filter(e => e.filePath === filePath)
          nextId = 0
          const fresh = buildOntology(projectPath)
          const freshEntities = fresh.graph.entities.filter(e => e.filePath === filePath)

          const cachedNames = new Set(cachedEntities.map(e => `${e.type}:${e.name}`))
          const freshNames = new Set(freshEntities.map(e => `${e.type}:${e.name}`))
          const removed = [...cachedNames].filter(n => !freshNames.has(n))
          const added = [...freshNames].filter(n => !cachedNames.has(n))

          if (removed.length > 0) issues.push(`Removed entities: ${removed.join(', ')}`)

          const passed = issues.filter(i => i.startsWith('Unbalanced')).length === 0

          const text = [
            `# Verification: ${filePath}`,
            `**Status**: ${passed ? 'PASSED' : 'FAILED'}`,
            `**Syntax**: ${braceCount === 0 && parenCount === 0 && bracketCount === 0 ? 'All delimiters balanced' : 'Issues found'}`,
            `**Entities**: ${cachedEntities.length} before → ${freshEntities.length} after`,
            added.length > 0 ? `**Added**: ${added.join(', ')}` : '',
            removed.length > 0 ? `**Removed**: ${removed.join(', ')}` : '',
            issues.length > 0 ? `\n## Issues\n${issues.map(i => `- ${i}`).join('\n')}` : '\nNo issues found.',
          ].filter(Boolean).join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'health_check': {
          const classes = graph.entities.filter(e => e.type === 'Class').length
          const funcs = graph.entities.filter(e => e.type === 'Function').length
          const files = graph.entities.filter(e => e.type === 'File').length
          const entityTypes: Record<string, number> = {}
          for (const e of graph.entities) entityTypes[e.type] = (entityTypes[e.type] || 0) + 1
          const text = [
            '# CodeWiki Health Check',
            `**Status**: Healthy`,
            `**Project**: ${path.basename(projectPath)}`,
            `**Path**: ${projectPath}`,
            `**Indexed**: ${files} files, ${classes} classes, ${funcs} functions`,
            `**Total entities**: ${graph.entities.length}`,
            `**Total relations**: ${graph.relations.length}`,
            `**Tools available**: 11 (read_wiki, search_code, get_entity_info, get_dependencies, get_impact_analysis, pre_check, verify_modification, health_check, get_relations, incremental_reindex, full_reindex)`,
            '',
            '## Entity Types',
            ...Object.entries(entityTypes).map(([t, c]) => `- ${t}: ${c}`),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'get_relations': {
          const entityName = String(args?.entity || '')
          const entity = graph.entities.find(e =>
            e.name.toLowerCase() === entityName.toLowerCase() ||
            e.id.toLowerCase().includes(entityName.toLowerCase()),
          )
          if (!entity) return { content: [{ type: 'text', text: `Entity not found: ${entityName}` }], isError: true }

          const outgoing = graph.relations
            .filter(r => r.source === entity.id)
            .map(r => {
              const t = graph.entities.find(e => e.id === r.target)
              return `  → ${r.type} → ${t?.name || r.target} (${t?.type || 'unknown'})`
            })

          const incoming = graph.relations
            .filter(r => r.target === entity.id)
            .map(r => {
              const s = graph.entities.find(e => e.id === r.source)
              return `  ← ${r.type} ← ${s?.name || r.source} (${s?.type || 'unknown'})`
            })

          const text = [
            `# Relations: ${entity.name} (${entity.type})`,
            `File: ${entity.filePath}:${entity.line}`,
            '',
            `## Outgoing (${outgoing.length})`,
            ...outgoing,
            '',
            `## Incoming (${incoming.length})`,
            ...incoming,
            '',
            `Total: ${outgoing.length + incoming.length} relations`,
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'find_callers': {
          const eName = String(args?.entity || '').toLowerCase()
          const bfsDepth = Number(args?.depth) || 3
          const entity = graph.entities.find(e => e.name.toLowerCase() === eName || e.id.toLowerCase().includes(eName))
          if (!entity) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found` }], isError: true }

          const callers: Array<{ name: string; type: string; file: string; line: number; depth: number }> = []
          const visited = new Set<string>()
          const queue = [{ id: entity.id, d: 0 }]
          while (queue.length > 0) {
            const cur = queue.shift()!
            if (cur.d > bfsDepth || visited.has(cur.id)) continue
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

          const text = [
            `# Callers of ${entity.name} (${entity.type})`,
            `File: ${entity.filePath}:${entity.line}`,
            `Total callers: ${callers.length}`,
            '',
            ...callers.map(c => `- **${c.name}** (${c.type}) at ${c.file}:${c.line} [depth ${c.depth}]`),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'find_callees': {
          const eName = String(args?.entity || '').toLowerCase()
          const bfsDepth = Number(args?.depth) || 3
          const entity = graph.entities.find(e => e.name.toLowerCase() === eName || e.id.toLowerCase().includes(eName))
          if (!entity) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found` }], isError: true }

          const callees: Array<{ name: string; type: string; file: string; line: number; depth: number }> = []
          const visited = new Set<string>()
          const queue = [{ id: entity.id, d: 0 }]
          while (queue.length > 0) {
            const cur = queue.shift()!
            if (cur.d > bfsDepth || visited.has(cur.id)) continue
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

          const text = [
            `# Callees of ${entity.name} (${entity.type})`,
            `File: ${entity.filePath}:${entity.line}`,
            `Total callees: ${callees.length}`,
            '',
            ...callees.map(c => `- **${c.name}** (${c.type}) at ${c.file}:${c.line} [depth ${c.depth}]`),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'trace_path': {
          const fromName = String(args?.from || '').toLowerCase()
          const toName = String(args?.to || '').toLowerCase()
          const maxDepth = Number(args?.depth) || 5
          const fromE = graph.entities.find(e => e.name.toLowerCase() === fromName || e.id.toLowerCase().includes(fromName))
          const toE = graph.entities.find(e => e.name.toLowerCase() === toName || e.id.toLowerCase().includes(toName))
          if (!fromE) return { content: [{ type: 'text', text: `Source entity "${args?.from}" not found` }], isError: true }
          if (!toE) return { content: [{ type: 'text', text: `Target entity "${args?.to}" not found` }], isError: true }

          const queue: Array<{ id: string; path: string[] }> = [{ id: fromE.id, path: [fromE.id] }]
          const visited = new Set<string>()
          let foundPath: string[] | null = null
          while (queue.length > 0 && !foundPath) {
            const cur = queue.shift()!
            if (cur.path.length > maxDepth + 1 || visited.has(cur.id)) continue
            visited.add(cur.id)
            if (cur.id === toE.id && cur.path.length > 1) { foundPath = cur.path; break }
            for (const r of graph.relations) {
              if ((r.type === 'calls' || r.type === 'uses' || r.type === 'imports' || r.type === 'dependsOn') && r.source === cur.id && !visited.has(r.target)) {
                const np = [...cur.path, r.target]
                if (r.target === toE.id) { foundPath = np; break }
                queue.push({ id: r.target, path: np })
              }
            }
            if (foundPath) break
          }

          if (!foundPath) {
            return { content: [{ type: 'text', text: `No call path found from ${args?.from} to ${args?.to}` }] }
          }

          const hops = foundPath.map((id, i) => {
            const e = graph.entities.find(ent => ent.id === id)
            return `${i + 1}. **${e?.name || id}** (${e?.type}) — ${e?.filePath}:${e?.line}`
          })
          const text = [
            `# Call Trace: ${args?.from} → ${args?.to}`,
            `Path length: ${foundPath.length - 1} hops`,
            '',
            ...hops,
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'blast_radius': {
          const eName = String(args?.entity || '').toLowerCase()
          const bfsDepth = Number(args?.depth) || 3
          const entity = graph.entities.find(e => e.name.toLowerCase() === eName || e.id.toLowerCase().includes(eName))
          if (!entity) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found` }], isError: true }

          const dependents = new Set<string>()
          const queue = [{ id: entity.id, d: 0 }]
          while (queue.length > 0) {
            const cur = queue.shift()!
            if (cur.d > bfsDepth || dependents.has(cur.id)) continue
            dependents.add(cur.id)
            for (const r of graph.relations) {
              if (r.target === cur.id && !dependents.has(r.source) && r.type !== 'contains') {
                queue.push({ id: r.source, d: cur.d + 1 })
              }
            }
          }
          dependents.delete(entity.id)

          const depEntities = graph.entities.filter(e => dependents.has(e.id))
          const byFile = new Map<string, typeof depEntities>()
          for (const e of depEntities) { const l = byFile.get(e.filePath) || []; l.push(e); byFile.set(e.filePath, l) }

          let risk = 'low'
          if (depEntities.length > 30 || byFile.size > 10) risk = 'CRITICAL'
          else if (depEntities.length > 15 || byFile.size > 5) risk = 'HIGH'
          else if (depEntities.length > 5 || byFile.size > 2) risk = 'MEDIUM'

          const text = [
            `# Blast Radius: ${entity.name} (${entity.type})`,
            `Risk: **${risk}**`,
            `Upstream dependents: ${depEntities.length}`,
            `Affected files: ${byFile.size}`,
            '',
            ...Array.from(byFile.entries()).map(([file, ents]) =>
              `## ${file}\n${ents.map(e => `  - ${e.name} (${e.type})`).join('\n')}`
            ),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'get_context': {
          const query = String(args?.query || '')
          const intent = String(args?.intent || 'explain')

          const searchResults = tfidfSearch(docs, query, 5)
          const matchedEntities = graph.entities.filter(e =>
            e.name.toLowerCase().includes(query.toLowerCase()) ||
            (e.signature && e.signature.toLowerCase().includes(query.toLowerCase()))
          )

          const blocks = matchedEntities.slice(0, 5).map(entity => {
            let source = ''
            if (entity.type !== 'File') {
              const fullPath = path.join(projectPath, entity.filePath)
              if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, 'utf-8').split('\n')
                source = content.slice(entity.line - 1, entity.endLine).join('\n')
              }
            }
            const callerRels = graph.relations.filter(r => r.type === 'calls' && r.target === entity.id)
            const calleeRels = graph.relations.filter(r => r.type === 'calls' && r.source === entity.id)
            const callers = callerRels.map(r => graph.entities.find(e => e.id === r.source)?.name).filter(Boolean)
            const callees = calleeRels.map(r => graph.entities.find(e => e.id === r.target)?.name).filter(Boolean)

            return [
              `## ${entity.type}: ${entity.name}`,
              `File: ${entity.filePath}:${entity.line}`,
              entity.signature ? `Signature: \`${entity.signature}\`` : '',
              `Callers: ${callers.join(', ') || 'none'}`,
              `Callees: ${callees.join(', ') || 'none'}`,
              source ? `\`\`\`\n${source.substring(0, 2000)}\n\`\`\`` : '',
            ].filter(Boolean).join('\n')
          })

          const text = [
            `# Context: "${query}" (intent: ${intent})`,
            `Matched entities: ${matchedEntities.length}`,
            '',
            ...blocks,
            '',
            searchResults.length > 0 ? `## Related Code\n${searchResults.map(r => `- ${r.filePath} (score: ${r.score.toFixed(2)})`).join('\n')}` : '',
          ].filter(Boolean).join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'get_edit_context': {
          const eName = String(args?.entity || '').toLowerCase()
          const entity = graph.entities.find(e => e.name.toLowerCase() === eName || e.id.toLowerCase().includes(eName))
          if (!entity) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found` }], isError: true }

          let source = ''
          if (entity.type !== 'File') {
            const fullPath = path.join(projectPath, entity.filePath)
            if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, 'utf-8').split('\n')
              source = content.slice(entity.line - 1, entity.endLine).join('\n')
            }
          }

          const callerRels = graph.relations.filter(r => r.type === 'calls' && r.target === entity.id)
          const calleeRels = graph.relations.filter(r => r.type === 'calls' && r.source === entity.id)
          const callers = callerRels.map(r => {
            const e = graph.entities.find(ent => ent.id === r.source)
            return e ? `- **${e.name}** (${e.type}) at ${e.filePath}:${e.line}` : null
          }).filter(Boolean)
          const callees = calleeRels.map(r => {
            const e = graph.entities.find(ent => ent.id === r.target)
            return e ? `- **${e.name}** (${e.type}) at ${e.filePath}:${e.line}` : null
          }).filter(Boolean)

          const siblings = graph.entities.filter(e =>
            e.filePath === entity.filePath && e.id !== entity.id && e.type !== 'File'
          )

          const testEntities = graph.entities.filter(e => {
            const n = e.name.toLowerCase()
            const f = e.filePath.toLowerCase()
            return (n.includes('test') || n.includes('spec') || f.includes('test') || f.includes('spec')) &&
              graph.relations.some(r => (r.source === e.id && r.target === entity.id) || (r.target === e.id && r.source === entity.id))
          })

          const text = [
            `# Edit Context: ${entity.name} (${entity.type})`,
            `File: ${entity.filePath}:${entity.line}-${entity.endLine}`,
            entity.signature ? `Signature: \`${entity.signature}\`` : '',
            '',
            `## Source`,
            `\`\`\`\n${source.substring(0, 3000)}\n\`\`\``,
            '',
            `## Callers (${callers.length})`,
            ...callers,
            '',
            `## Callees (${callees.length})`,
            ...callees,
            '',
            `## Related Tests (${testEntities.length})`,
            ...testEntities.map(e => `- **${e.name}** at ${e.filePath}:${e.line}`),
            testEntities.length === 0 ? '⚠️ No tests found — consider adding test coverage before editing' : '',
            '',
            `## Siblings in Same File (${siblings.length})`,
            ...siblings.slice(0, 10).map(e => `- ${e.name} (${e.type})`),
          ].filter(Boolean).join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'explore_symbols': {
          const names = String(args?.entities || '').split(',').map(s => s.trim()).filter(Boolean)
          if (names.length === 0) return { content: [{ type: 'text', text: 'No entity names provided' }], isError: true }

          const found: Array<{ entity: typeof graph.entities[0]; source: string }> = []
          const notFound: string[] = []
          for (const name of names) {
            const e = graph.entities.find(ent => ent.name.toLowerCase() === name.toLowerCase() || ent.id.toLowerCase().includes(name.toLowerCase()))
            if (!e) { notFound.push(name); continue }
            let source = ''
            if (e.type !== 'File') {
              const fullPath = path.join(projectPath, e.filePath)
              if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, 'utf-8').split('\n')
                source = content.slice(e.line - 1, e.endLine).join('\n')
              }
            }
            found.push({ entity: e, source })
          }

          const byFile = new Map<string, typeof found>()
          for (const f of found) { const l = byFile.get(f.entity.filePath) || []; l.push(f); byFile.set(f.entity.filePath, l) }

          const foundIds = new Set(found.map(f => f.entity.id))
          const relationships = graph.relations
            .filter(r => foundIds.has(r.source) && foundIds.has(r.target))
            .map(r => {
              const src = graph.entities.find(e => e.id === r.source)
              const tgt = graph.entities.find(e => e.id === r.target)
              return `  ${src?.name} --${r.type}--> ${tgt?.name}`
            })

          const text = [
            `# Explore: ${names.join(', ')}`,
            notFound.length > 0 ? `Not found: ${notFound.join(', ')}` : '',
            '',
            ...Array.from(byFile.entries()).map(([file, symbols]) => [
              `## ${file}`,
              ...symbols.map(s => [
                `### ${s.entity.type}: ${s.entity.name} (line ${s.entity.line})`,
                s.source ? `\`\`\`\n${s.source.substring(0, 2000)}\n\`\`\`` : '',
              ].filter(Boolean).join('\n')),
            ].join('\n')),
            '',
            relationships.length > 0 ? `## Relationships\n${relationships.join('\n')}` : '',
          ].filter(Boolean).join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'file_context': {
          const filePath = String(args?.file || '').replace(/\\/g, '/')
          const fileEntity = graph.entities.find(e =>
            e.type === 'File' && e.filePath.replace(/\\/g, '/').endsWith(filePath)
          )
          if (!fileEntity) return { content: [{ type: 'text', text: `File "${args?.file}" not found in index` }], isError: true }

          const defined = graph.entities.filter(e => e.filePath === fileEntity.filePath && e.type !== 'File')
          const fileEntityIds = new Set([fileEntity.id, ...defined.map(e => e.id)])

          const imports: string[] = []
          for (const r of graph.relations) {
            if (r.type === 'imports' && fileEntityIds.has(r.source)) {
              const target = graph.entities.find(e => e.id === r.target)
              if (target && !fileEntityIds.has(target.id)) {
                imports.push(`- ${target.name} (${target.type}) from ${target.filePath}`)
              }
            }
          }

          const text = [
            `# File: ${fileEntity.filePath}`,
            '',
            `## Defined Symbols (${defined.length})`,
            ...defined.map(e => `- **${e.name}** (${e.type}) line ${e.line}${e.signature ? ` — \`${e.signature}\`` : ''}`),
            '',
            `## Imports (${imports.length})`,
            ...imports,
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'analyze_complexity': {
          const eName = String(args?.entity || '').toLowerCase()
          const entity = graph.entities.find(e => e.name.toLowerCase() === eName || e.id.toLowerCase().includes(eName))
          if (!entity) return { content: [{ type: 'text', text: `Entity "${args?.entity}" not found` }], isError: true }

          let source = ''
          if (entity.type !== 'File') {
            const fullPath = path.join(projectPath, entity.filePath)
            if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, 'utf-8').split('\n')
              source = content.slice(entity.line - 1, entity.endLine).join('\n')
            }
          }

          const branches = (source.match(/\bif\b|\belse\s+if\b|\bcase\b|\bcatch\b|\b\?\s/g) || []).length
          const loops = (source.match(/\bfor\b|\bwhile\b|\bdo\b|\b\.forEach\b|\b\.map\b|\b\.filter\b|\b\.reduce\b/g) || []).length
          const conditions = (source.match(/&&|\|\|/g) || []).length
          const lines = source.split('\n').length
          const cyclomatic = 1 + branches + conditions

          let grade = 'A'
          if (cyclomatic > 20) grade = 'F'
          else if (cyclomatic > 15) grade = 'D'
          else if (cyclomatic > 10) grade = 'C'
          else if (cyclomatic > 5) grade = 'B'

          const outgoing = graph.relations.filter(r => r.source === entity.id).length
          const incoming = graph.relations.filter(r => r.target === entity.id).length

          const text = [
            `# Complexity: ${entity.name} (${entity.type})`,
            `File: ${entity.filePath}:${entity.line}`,
            '',
            `| Metric | Value |`,
            `|--------|-------|`,
            `| Grade | **${grade}** |`,
            `| Cyclomatic Complexity | ${cyclomatic} |`,
            `| Lines | ${lines} |`,
            `| Branches | ${branches} |`,
            `| Loops | ${loops} |`,
            `| Boolean Conditions | ${conditions} |`,
            `| Coupling Out | ${outgoing} |`,
            `| Coupling In | ${incoming} |`,
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'find_dead_code': {
          const deadCode: Array<{ name: string; type: string; file: string; line: number; category: string }> = []
          for (const entity of graph.entities) {
            if (entity.type === 'File') continue
            const incomingRels = graph.relations.filter(r => r.target === entity.id && r.type !== 'contains')
            const outContains = graph.relations.filter(r => r.source === entity.id && r.type === 'contains')
            if (outContains.length > 0 && entity.type === 'Class') continue
            if (incomingRels.length === 0) {
              const isTest = entity.filePath.includes('test') || entity.filePath.includes('spec')
              const isEntry = entity.name === 'main' || entity.name === 'default' || entity.filePath.includes('index.') || entity.filePath.includes('app.')
              if (isTest || isEntry) continue
              const isExported = entity.signature?.startsWith('export') || false
              deadCode.push({ name: entity.name, type: entity.type, file: entity.filePath, line: entity.line, category: isExported ? 'exported-unused' : 'orphan' })
            }
          }
          const byFile = new Map<string, typeof deadCode>()
          for (const d of deadCode) { const l = byFile.get(d.file) || []; l.push(d); byFile.set(d.file, l) }
          const text = [
            `# Dead Code Report`,
            `**Total unreferenced symbols**: ${deadCode.length}`,
            `- Orphan (no references): ${deadCode.filter(d => d.category === 'orphan').length}`,
            `- Exported but unused: ${deadCode.filter(d => d.category === 'exported-unused').length}`,
            '',
            ...Array.from(byFile.entries()).map(([file, items]) =>
              `### ${file}\n${items.map(d => `- \`${d.name}\` (${d.type}, line ${d.line}) — ${d.category}`).join('\n')}`
            ),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'find_references': {
          const entityName = String(args?.entity || '')
          const entity = graph.entities.find(e => e.name === entityName && e.type !== 'File')
          if (!entity) return { content: [{ type: 'text', text: `Entity "${entityName}" not found.` }], isError: true }

          const graphRefs = graph.relations
            .filter(r => r.target === entity.id && r.type !== 'contains')
            .map(r => {
              const src = graph.entities.find(e => e.id === r.source)
              return src ? `- \`${src.name}\` (${src.type}) in ${src.filePath}:${src.line} — ${r.type}` : null
            }).filter(Boolean)

          const nameRegex = new RegExp(`\\b${entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
          const textRefs: string[] = []
          for (const [fp, content] of fileContents) {
            const relPath = path.relative(projectPath, fp)
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              if (relPath.replace(/\\/g, '/') === entity.filePath.replace(/\\/g, '/') && i + 1 === entity.line) continue
              if (nameRegex.test(lines[i])) {
                textRefs.push(`- ${relPath}:${i + 1}: \`${lines[i].trim().substring(0, 100)}\``)
              }
              nameRegex.lastIndex = 0
            }
          }

          const text = [
            `# References: ${entity.name} (${entity.type})`,
            `Defined at: ${entity.filePath}:${entity.line}`,
            '',
            `## Graph References (${graphRefs.length})`,
            ...graphRefs,
            '',
            `## Text References (${textRefs.length})`,
            ...textRefs.slice(0, 30),
            ...(textRefs.length > 30 ? [`... and ${textRefs.length - 30} more`] : []),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'get_key_symbols': {
          const topN = Number(args?.top) || 15
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
          if (n === 0) return { content: [{ type: 'text', text: 'No entities found.' }] }
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
          const sorted = entities.map(e => ({ entity: e, rank: ranks.get(e.id) || 0, inDeg: inLinks.get(e.id)?.length || 0, outDeg: outLinks.get(e.id)?.length || 0 }))
            .sort((a, b) => b.rank - a.rank).slice(0, topN)
          const text = [
            `# Key Symbols (PageRank)`,
            `| Rank | Symbol | Type | File | In-Degree | Out-Degree |`,
            `|------|--------|------|------|-----------|------------|`,
            ...sorted.map((s, i) => `| ${i + 1} | \`${s.entity.name}\` | ${s.entity.type} | ${s.entity.filePath}:${s.entity.line} | ${s.inDeg} | ${s.outDeg} |`),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'trace_route': {
          const routePath = String(args?.route || '')
          const maxDepth = Number(args?.depth) || 5
          const routePatterns = [
            new RegExp(`(?:app|router)\\s*\\.\\s*(?:get|post|put|delete|patch|all|use)\\s*\\(\\s*['"\`]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'i'),
            new RegExp(`@(?:app|router)\\.(?:get|post|put|delete|patch)\\s*\\(\\s*['"]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'i'),
            new RegExp(`['"\`]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'i'),
          ]
          const matches: Array<{ file: string; line: number; text: string }> = []
          for (const [fp, content] of fileContents) {
            const relPath = path.relative(projectPath, fp)
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              for (const p of routePatterns) {
                if (p.test(lines[i])) { matches.push({ file: relPath, line: i + 1, text: lines[i].trim().substring(0, 120) }); break }
              }
            }
          }
          const chains: string[] = []
          for (const m of matches.slice(0, 5)) {
            const handler = graph.entities.find(e =>
              e.filePath.replace(/\\/g, '/') === m.file.replace(/\\/g, '/') && e.line <= m.line && e.endLine >= m.line && e.type !== 'File'
            ) || graph.entities.find(e =>
              e.filePath.replace(/\\/g, '/') === m.file.replace(/\\/g, '/') && Math.abs(e.line - m.line) < 10 && e.type !== 'File'
            )
            if (!handler) continue
            const chain = [handler.name]
            const visited = new Set([handler.id])
            const queue = [{ id: handler.id, d: 0 }]
            while (queue.length > 0) {
              const cur = queue.shift()!
              if (cur.d >= maxDepth) continue
              for (const r of graph.relations) {
                if (r.type === 'calls' && r.source === cur.id && !visited.has(r.target)) {
                  visited.add(r.target)
                  const callee = graph.entities.find(e => e.id === r.target)
                  if (callee) { chain.push(callee.name); queue.push({ id: callee.id, d: cur.d + 1 }) }
                }
              }
            }
            chains.push(`**${m.file}:${m.line}**: ${chain.join(' → ')}`)
          }
          const text = [
            `# Route Trace: ${routePath}`,
            `**Matched files**: ${matches.length}`,
            '',
            ...(chains.length > 0 ? chains : ['No route handlers found matching this path.']),
          ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'lsif_status': {
          const candidates = ['index.scip', 'dump.lsif', 'index.lsif', '.codewiki/index.scip']
          let found: string | null = null
          for (const c of candidates) { if (fs.existsSync(path.join(projectPath, c))) { found = c; break } }
          const text = found
            ? `LSIF/SCIP index found: \`${found}\`. Compiler-accurate references are being used to enrich the ontology.`
            : [
              '# No LSIF/SCIP Index Found',
              '',
              'Generate one for compiler-accurate code intelligence:',
              '- **TypeScript/JS**: `npm i -g @sourcegraph/scip-typescript && scip-typescript index`',
              '- **Python**: `pip install scip-python && scip-python index`',
              '- **Java/Kotlin/Scala**: See https://github.com/sourcegraph/scip-java',
              '- **Rust**: `rust-analyzer scip .`',
              '- **Go**: See https://github.com/sourcegraph/scip-go',
            ].join('\n')
          return { content: [{ type: 'text', text }] }
        }

        case 'incremental_reindex': {
          const newHashes = getFileHashes(projectPath)
          const changes = detectChanges(fileHashes, newHashes)
          const totalChanges = changes.added.length + changes.modified.length + changes.removed.length

          if (totalChanges === 0) {
            return { content: [{ type: 'text', text: `No changes detected since last index (${new Date(lastIndexTime).toISOString()}).` }] }
          }

          // Full rebuild for now (incremental entity removal is complex)
          nextId = 0
          const fresh = buildOntology(projectPath)
          graph = fresh.graph
          fileContents = fresh.fileContents
          docs = Array.from(fileContents.entries()).map(([p, c]) => ({
            id: p, content: c.substring(0, 8000), filePath: path.relative(projectPath, p),
          }))
          fileHashes = newHashes
          lastIndexTime = Date.now()

          const text = [
            `# Incremental Reindex Complete`,
            `**Changes detected**: ${totalChanges}`,
            `- Added: ${changes.added.length} files`,
            `- Modified: ${changes.modified.length} files`,
            `- Removed: ${changes.removed.length} files`,
            '',
            `**New totals**: ${graph.entities.length} entities, ${graph.relations.length} relations`,
            `**Last indexed**: ${new Date(lastIndexTime).toISOString()}`,
          ].join('\n')
          process.stderr.write(`Reindexed: +${changes.added.length} ~${changes.modified.length} -${changes.removed.length}\n`)
          return { content: [{ type: 'text', text }] }
        }

        case 'full_reindex': {
          nextId = 0
          const fresh = buildOntology(projectPath)
          graph = fresh.graph
          fileContents = fresh.fileContents
          docs = Array.from(fileContents.entries()).map(([p, c]) => ({
            id: p, content: c.substring(0, 8000), filePath: path.relative(projectPath, p),
          }))
          fileHashes = getFileHashes(projectPath)
          lastIndexTime = Date.now()

          const text = [
            `# Full Reindex Complete`,
            `**Entities**: ${graph.entities.length}`,
            `**Relations**: ${graph.relations.length}`,
            `**Files**: ${docs.length}`,
            `**Last indexed**: ${new Date(lastIndexTime).toISOString()}`,
          ].join('\n')
          process.stderr.write(`Full reindex: ${graph.entities.length} entities, ${docs.length} files.\n`)
          return { content: [{ type: 'text', text }] }
        }

        case 'get_architecture': {
          const langMap = new Map<string, number>()
          for (const e of graph.entities) {
            if (e.type !== 'File') continue
            const ext = path.extname(e.filePath).toLowerCase()
            const lang: Record<string, string> = { '.ts': 'TypeScript', '.tsx': 'TypeScript/React', '.js': 'JavaScript', '.py': 'Python', '.java': 'Java', '.rs': 'Rust', '.go': 'Go' }
            langMap.set(lang[ext] || ext, (langMap.get(lang[ext] || ext) || 0) + 1)
          }
          const inDeg = new Map<string, number>()
          for (const r of graph.relations) { if (r.type !== 'contains') inDeg.set(r.target, (inDeg.get(r.target) || 0) + 1) }
          const hotspots = Array.from(inDeg.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => {
            const e = graph.entities.find(ent => ent.id === id)
            return e ? `${e.name} (${e.type}, ${count} deps)` : null
          }).filter(Boolean)
          const layers = new Map<string, number>()
          for (const e of graph.entities) { if (e.type !== 'File') layers.set(path.dirname(e.filePath) || '.', (layers.get(path.dirname(e.filePath) || '.') || 0) + 1) }
          const archText = [
            '# Architecture Overview',
            `**Entities**: ${graph.entities.filter(e => e.type !== 'File').length} | **Relations**: ${graph.relations.length} | **Files**: ${graph.entities.filter(e => e.type === 'File').length}`,
            '',
            '## Languages',
            ...Array.from(langMap.entries()).sort((a, b) => b[1] - a[1]).map(([l, c]) => `- ${l}: ${c} files`),
            '',
            '## Hotspots (most depended-upon)',
            ...hotspots.map((h, i) => `${i + 1}. ${h}`),
            '',
            '## Layers',
            ...Array.from(layers.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, c]) => `- \`${d}\`: ${c} entities`),
          ].join('\n')
          return { content: [{ type: 'text', text: archText }] }
        }

        case 'detect_changes': {
          let diffText = '# Git Diff Impact\nNo uncommitted changes detected.'
          try {
            const { execSync } = require('child_process')
            const diffOut = execSync('git diff --name-only', { cwd: projectPath, encoding: 'utf-8' })
            const stagedOut = execSync('git diff --staged --name-only', { cwd: projectPath, encoding: 'utf-8' })
            const allChanged = new Set([...diffOut.trim().split('\n'), ...stagedOut.trim().split('\n')].filter(Boolean))
            if (allChanged.size > 0) {
              const symbols: string[] = []
              for (const file of allChanged) {
                const ents = graph.entities.filter(e => e.filePath === file || e.filePath.endsWith(file))
                for (const e of ents) { if (e.type !== 'File') symbols.push(`- **${e.name}** (${e.type}) in \`${e.filePath}\``) }
              }
              diffText = [
                '# Git Diff Impact',
                `**Changed files**: ${allChanged.size}`,
                `**Affected symbols**: ${symbols.length}`,
                '', '## Affected Symbols', ...symbols.slice(0, 30),
              ].join('\n')
            }
          } catch { /* not a git repo */ }
          return { content: [{ type: 'text', text: diffText }] }
        }

        case 'detect_communities': {
          const entityIds = graph.entities.filter(e => e.type !== 'File').map(e => e.id)
          const idSet = new Set(entityIds)
          const adj = new Map<string, Set<string>>()
          for (const id of entityIds) adj.set(id, new Set())
          for (const r of graph.relations) {
            if (r.type === 'contains') continue
            if (idSet.has(r.source) && idSet.has(r.target)) { adj.get(r.source)!.add(r.target); adj.get(r.target)!.add(r.source) }
          }
          const visited = new Set<string>()
          const clusters: Array<{ members: string[]; files: Set<string> }> = []
          for (const sid of entityIds) {
            if (visited.has(sid)) continue
            const comp: string[] = []
            const q = [sid]; visited.add(sid)
            while (q.length > 0) { const c = q.shift()!; comp.push(c); for (const n of adj.get(c) || []) { if (!visited.has(n)) { visited.add(n); q.push(n) } } }
            const files = new Set<string>()
            for (const id of comp) { const e = graph.entities.find(ent => ent.id === id); if (e) files.add(e.filePath) }
            clusters.push({ members: comp, files })
          }
          clusters.sort((a, b) => b.members.length - a.members.length)
          const clText = [
            `# Community Detection`,
            `**${clusters.length} clusters** found`,
            '',
            ...clusters.slice(0, 10).map((c, i) => {
              const names = c.members.slice(0, 5).map(id => { const e = graph.entities.find(ent => ent.id === id); return e ? e.name : id }).join(', ')
              return `## Cluster ${i + 1} (${c.members.length} members, ${c.files.size} files)\n${names}${c.members.length > 5 ? ` (+${c.members.length - 5} more)` : ''}`
            }),
          ].join('\n')
          return { content: [{ type: 'text', text: clText }] }
        }

        case 'suggest_tests': {
          const entityName = (args as Record<string, string>).entity
          const entity = graph.entities.find(e => e.name.toLowerCase() === entityName.toLowerCase() && e.type !== 'File')
          if (!entity) return { content: [{ type: 'text', text: `Entity "${entityName}" not found.` }], isError: true }
          const testFiles: string[] = []
          for (const [file, content] of fileContents.entries()) {
            const fn = file.toLowerCase(); const lc = content.toLowerCase()
            if (fn.includes('test') || fn.includes('spec') || fn.includes('__tests__')) {
              if (lc.includes(entity.name.toLowerCase())) testFiles.push(path.relative(projectPath, file))
            }
          }
          const testText = [
            `# Suggested Tests for ${entity.name}`,
            testFiles.length > 0 ? testFiles.map(f => `- \`${f}\``).join('\n') : 'No direct test files found referencing this entity.',
          ].join('\n')
          return { content: [{ type: 'text', text: testText }] }
        }

        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
    }
  }

  // Wrap every tool call with timing + accuracy scoring, recording it to the shared call log.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const t0 = Date.now()
    let result: ToolResult
    try {
      result = await runTool(request)
    } catch (err) {
      result = { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
    }
    const duration = Date.now() - t0
    const isError = result.isError === true
    const text = (result.content || []).map(c => c.text || '').join('\n')
    appendMcpCallLog({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      source: 'mcp',
      command: name,
      args: { ...(args || {}), consumer: process.env.CODEWIKI_CONSUMER || 'mcp' },
      result: { text: text.slice(0, 2000), isError },
      duration,
      accuracy: scoreMcpResult(name, isError, text),
      status: isError ? 'error' : 'success',
    })
    return result
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('CodeWiki MCP Server running on stdio.\n')
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
