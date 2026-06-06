/**
 * MCP (Model Context Protocol) Server
 * 
 * Provides MCP-compatible tools for IDEs and other agents
 * to query the code wiki, search code, and get precise modifications.
 */

import type { WikiProject } from '../types'
import { VectorStore } from './vector-store'
import { OntologyBuilder } from './ontology'

export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

export interface MCPToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/**
 * MCP Server implementation that can be run as a stdio server
 * or integrated into the Electron app.
 */
export class MCPServer {
  private project: WikiProject | null = null
  private vectorStore: VectorStore | null = null

  setProject(project: WikiProject) {
    this.project = project
  }

  setVectorStore(store: VectorStore) {
    this.vectorStore = store
  }

  getTools(): MCPTool[] {
    return [
      {
        name: 'read_wiki',
        description: 'Read the wiki documentation for the current project. Returns the wiki page content.',
        inputSchema: {
          type: 'object',
          properties: {
            page: {
              type: 'string',
              description: 'Wiki page slug (e.g., "project-overview", "architecture", "api-reference"). Leave empty for table of contents.',
            },
          },
          required: [],
        },
      },
      {
        name: 'search_code',
        description: 'Semantic search across the codebase. Returns relevant code snippets ranked by relevance.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query (e.g., "user authentication logic", "database connection setup")',
            },
            limit: {
              type: 'string',
              description: 'Maximum number of results (default: 5)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_entity_info',
        description: 'Get detailed information about a code entity (class, function, interface) from the ontology graph.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Entity name (e.g., "UserService", "handleRequest")',
            },
            type: {
              type: 'string',
              description: 'Entity type filter: Class, Function, Interface, Method, etc.',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_dependencies',
        description: 'Get the dependency graph for a specific entity or file. Shows what it imports/uses and what depends on it.',
        inputSchema: {
          type: 'object',
          properties: {
            entity: {
              type: 'string',
              description: 'Entity name or file path to analyze',
            },
            depth: {
              type: 'string',
              description: 'How many levels of dependencies to traverse (default: 2)',
            },
          },
          required: ['entity'],
        },
      },
      {
        name: 'get_impact_analysis',
        description: 'Analyze what would be affected by modifying a specific entity. Critical for preventing hallucination in code modifications.',
        inputSchema: {
          type: 'object',
          properties: {
            entity: {
              type: 'string',
              description: 'Entity name to analyze impact for',
            },
          },
          required: ['entity'],
        },
      },
    ]
  }

  async handleToolCall(call: MCPToolCall): Promise<MCPToolResult> {
    try {
      switch (call.name) {
        case 'read_wiki':
          return this.handleReadWiki(call.arguments.page as string | undefined)
        case 'search_code':
          return this.handleSearchCode(
            call.arguments.query as string,
            parseInt(call.arguments.limit as string || '5'),
          )
        case 'get_entity_info':
          return this.handleGetEntityInfo(
            call.arguments.name as string,
            call.arguments.type as string | undefined,
          )
        case 'get_dependencies':
          return this.handleGetDependencies(
            call.arguments.entity as string,
            parseInt(call.arguments.depth as string || '2'),
          )
        case 'get_impact_analysis':
          return this.handleGetImpactAnalysis(call.arguments.entity as string)
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${call.name}` }], isError: true }
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      }
    }
  }

  private handleReadWiki(page?: string): MCPToolResult {
    if (!this.project) {
      return { content: [{ type: 'text', text: 'No project loaded. Please open a project first.' }] }
    }

    if (!page) {
      const toc = this.project.wikiPages
        .map(p => `- [${p.title}](${p.slug})`)
        .join('\n')
      return { content: [{ type: 'text', text: `# ${this.project.name} Wiki\n\n${toc}` }] }
    }

    const wikiPage = this.project.wikiPages.find(p => p.slug === page || p.title.toLowerCase().includes(page.toLowerCase()))
    if (!wikiPage) {
      return { content: [{ type: 'text', text: `Page "${page}" not found. Available pages: ${this.project.wikiPages.map(p => p.slug).join(', ')}` }] }
    }

    return { content: [{ type: 'text', text: wikiPage.content }] }
  }

  private async handleSearchCode(query: string, limit: number): Promise<MCPToolResult> {
    if (!this.vectorStore) {
      return { content: [{ type: 'text', text: 'No code indexed. Please index a project first.' }] }
    }

    const results = await this.vectorStore.searchHybrid(query, limit)
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No results found for "${query}"` }] }
    }

    const text = results.map((r, i) =>
      `### Result ${i + 1} (score: ${r.score.toFixed(3)})\n**File**: ${r.metadata.filePath}\n\`\`\`\n${r.content}\n\`\`\``
    ).join('\n\n')

    return { content: [{ type: 'text', text }] }
  }

  private handleGetEntityInfo(name: string, type?: string): MCPToolResult {
    if (!this.project) {
      return { content: [{ type: 'text', text: 'No project loaded.' }] }
    }

    let entities = this.project.ontologyGraph.entities.filter(
      e => e.name.toLowerCase().includes(name.toLowerCase())
    )
    if (type) {
      entities = entities.filter(e => e.type.toLowerCase() === type.toLowerCase())
    }

    if (entities.length === 0) {
      return { content: [{ type: 'text', text: `No entity found matching "${name}"` }] }
    }

    const text = entities.map(e => {
      const relations = this.project!.ontologyGraph.relations
        .filter(r => r.source === e.id || r.target === e.id)
        .map(r => {
          const other = r.source === e.id
            ? this.project!.ontologyGraph.entities.find(ent => ent.id === r.target)
            : this.project!.ontologyGraph.entities.find(ent => ent.id === r.source)
          const direction = r.source === e.id ? '->' : '<-'
          return `  ${direction} ${r.type} ${other?.name || 'unknown'} (${other?.type})`
        })

      return `## ${e.type}: ${e.name}\n**File**: ${e.filePath}:${e.line}\n${e.signature ? `**Signature**: \`${e.signature}\`\n` : ''}**Relations**:\n${relations.join('\n') || '  (none)'}`
    }).join('\n\n')

    return { content: [{ type: 'text', text }] }
  }

  private handleGetDependencies(entityName: string, depth: number): MCPToolResult {
    if (!this.project) {
      return { content: [{ type: 'text', text: 'No project loaded.' }] }
    }

    const entity = this.project.ontologyGraph.entities.find(
      e => e.name.toLowerCase() === entityName.toLowerCase()
    )
    if (!entity) {
      return { content: [{ type: 'text', text: `Entity "${entityName}" not found.` }] }
    }

    const graph = this.project.ontologyGraph
    const visited = new Set<string>()
    const deps: string[] = []

    const traverse = (id: string, d: number, prefix: string) => {
      if (d > depth || visited.has(id)) return
      visited.add(id)

      const outgoing = graph.relations.filter(r => r.source === id)
      for (const rel of outgoing) {
        const target = graph.entities.find(e => e.id === rel.target)
        if (target) {
          deps.push(`${prefix}${rel.type} -> ${target.type}:${target.name} (${target.filePath}:${target.line})`)
          traverse(rel.target, d + 1, prefix + '  ')
        }
      }
    }

    traverse(entity.id, 0, '')

    return {
      content: [{
        type: 'text',
        text: `# Dependencies of ${entity.type}:${entity.name}\n\n${deps.join('\n') || 'No dependencies found.'}`,
      }],
    }
  }

  private handleGetImpactAnalysis(entityName: string): MCPToolResult {
    if (!this.project) {
      return { content: [{ type: 'text', text: 'No project loaded.' }] }
    }

    const entity = this.project.ontologyGraph.entities.find(
      e => e.name.toLowerCase() === entityName.toLowerCase()
    )
    if (!entity) {
      return { content: [{ type: 'text', text: `Entity "${entityName}" not found.` }] }
    }

    const impacted = OntologyBuilder.getImpactedEntities(entity.id, this.project.ontologyGraph, 3)
    const impactedEntities = this.project.ontologyGraph.entities
      .filter(e => impacted.has(e.id) && e.id !== entity.id)

    const byFile = new Map<string, typeof impactedEntities>()
    for (const e of impactedEntities) {
      const list = byFile.get(e.filePath) || []
      list.push(e)
      byFile.set(e.filePath, list)
    }

    const text = [
      `# Impact Analysis: ${entity.type} ${entity.name}`,
      `**File**: ${entity.filePath}:${entity.line}`,
      `**Total impacted entities**: ${impactedEntities.length}`,
      `**Impacted files**: ${byFile.size}`,
      '',
      ...Array.from(byFile.entries()).map(([file, entities]) =>
        `## ${file}\n${entities.map(e => `- ${e.type}: ${e.name} (line ${e.line})`).join('\n')}`
      ),
    ].join('\n')

    return { content: [{ type: 'text', text }] }
  }
}
