/**
 * Code Agent Service
 * 
 * Provides precise code modification capabilities using
 * ontology-based impact analysis to prevent hallucination.
 * 
 * Key innovation: Before modifying code, the agent queries the
 * ontology graph to understand the full impact scope, ensuring
 * all affected files/entities are identified and updated together.
 */

import type { OntologyGraph, CodeModification, CodeSource } from '../types'
import { OntologyBuilder } from './ontology'
import { LLMService } from './llm'
import { VectorStore } from './vector-store'

const CODE_AGENT_SYSTEM = `You are a precise code modification agent. Your key advantage is that you have access to a code ontology graph that shows exact relationships between code entities.

CRITICAL RULES:
1. NEVER guess or hallucinate about code structure. Only reference entities that exist in the ontology.
2. When modifying code, ALWAYS consider the impact on related entities (callers, implementations, tests).
3. Return modifications as structured JSON with exact file paths and line numbers.
4. Preserve existing code style and conventions.
5. Ensure type safety - check that all types are compatible after modifications.

Response format (JSON):
{
  "analysis": "Brief analysis of what needs to change and why",
  "impactedFiles": ["file1.ts", "file2.ts"],
  "modifications": [
    {
      "filePath": "path/to/file.ts",
      "startLine": 10,
      "endLine": 15,
      "originalContent": "original code here",
      "newContent": "modified code here",
      "description": "What this change does"
    }
  ],
  "warnings": ["Any potential issues or side effects"]
}`

export class CodeAgent {
  private llm: LLMService
  private vectorStore: VectorStore

  constructor(llm: LLMService, vectorStore: VectorStore) {
    this.llm = llm
    this.vectorStore = vectorStore
  }

  /**
   * Analyze a code modification request and return precise changes
   */
  async analyzeModification(
    request: string,
    graph: OntologyGraph,
    readFile: (path: string) => Promise<string | null>,
  ): Promise<{
    analysis: string
    modifications: CodeModification[]
    impactedFiles: string[]
    warnings: string[]
  }> {
    // Step 1: Find relevant code through semantic search
    const searchResults = this.vectorStore.search(request, 10)

    // Step 2: Identify relevant entities from ontology
    const relevantEntities = this.findRelevantEntities(request, graph)

    // Step 3: Get impact analysis for each relevant entity
    const allImpacted = new Set<string>()
    for (const entity of relevantEntities) {
      const impacted = OntologyBuilder.getImpactedEntities(entity.id, graph, 2)
      for (const id of impacted) allImpacted.add(id)
    }

    const impactedEntities = graph.entities.filter(e => allImpacted.has(e.id))
    const impactedFiles = [...new Set(impactedEntities.map(e => e.filePath))]

    // Step 4: Gather context from impacted files
    const fileContexts: string[] = []
    for (const filePath of impactedFiles.slice(0, 15)) {
      const content = await readFile(filePath)
      if (content) {
        fileContexts.push(`### ${filePath}\n\`\`\`\n${content.substring(0, 8000)}\n\`\`\``)
      }
    }

    // Step 5: Ask LLM for precise modifications
    const response = await this.llm.chat([
      { role: 'system', content: CODE_AGENT_SYSTEM },
      {
        role: 'user',
        content: `Modification request: ${request}

Relevant entities from ontology:
${relevantEntities.map(e => `- ${e.type} ${e.name} at ${e.filePath}:${e.line} ${e.signature ? '(' + e.signature + ')' : ''}`).join('\n')}

Impacted entities (via dependency graph):
${impactedEntities.slice(0, 30).map(e => `- ${e.type} ${e.name} at ${e.filePath}:${e.line}`).join('\n')}

Semantic search results:
${searchResults.slice(0, 5).map(r => `- ${r.metadata.filePath} (score: ${r.score.toFixed(3)}): ${r.content.substring(0, 200)}`).join('\n')}

File contents:
${fileContexts.join('\n\n')}

Provide precise modifications in the specified JSON format.`,
      },
    ])

    try {
      // Try to parse JSON from response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          analysis: parsed.analysis || 'Analysis complete',
          modifications: (parsed.modifications || []).map((m: Record<string, unknown>) => ({
            ...m,
            affectedEntities: impactedEntities
              .filter(e => e.filePath === m.filePath)
              .map(e => e.id),
          })),
          impactedFiles: parsed.impactedFiles || impactedFiles,
          warnings: parsed.warnings || [],
        }
      }
    } catch {
      // If JSON parsing fails, return the raw analysis
    }

    return {
      analysis: response.content,
      modifications: [],
      impactedFiles,
      warnings: ['Could not parse structured modifications. Review the analysis above.'],
    }
  }

  /**
   * Find relevant code context for a user query using both
   * vector search and ontology graph traversal
   */
  async findContext(
    query: string,
    graph: OntologyGraph,
    readFile: (path: string) => Promise<string | null>,
  ): Promise<CodeSource[]> {
    const sources: CodeSource[] = []

    // Vector search
    const searchResults = this.vectorStore.search(query, 5)
    for (const result of searchResults) {
      const content = await readFile(result.id)
      if (content) {
        sources.push({
          filePath: result.metadata.filePath || result.id,
          startLine: 1,
          endLine: content.split('\n').length,
          content: content.substring(0, 5000),
          relevance: result.score,
        })
      }
    }

    // Ontology-based search
    const entities = this.findRelevantEntities(query, graph)
    for (const entity of entities.slice(0, 5)) {
      const content = await readFile(entity.filePath)
      if (content) {
        const lines = content.split('\n')
        const snippet = lines.slice(entity.line - 1, entity.endLine).join('\n')
        sources.push({
          filePath: entity.filePath,
          startLine: entity.line,
          endLine: entity.endLine,
          content: snippet.substring(0, 5000),
          relevance: 0.8,
        })
      }
    }

    // Deduplicate and sort by relevance
    const seen = new Set<string>()
    return sources.filter(s => {
      const key = `${s.filePath}:${s.startLine}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => b.relevance - a.relevance)
  }

  private findRelevantEntities(query: string, graph: OntologyGraph) {
    const queryTerms = query.toLowerCase().split(/\s+/)
    return graph.entities
      .map(entity => {
        let score = 0
        const name = entity.name.toLowerCase()
        const sig = (entity.signature || '').toLowerCase()
        for (const term of queryTerms) {
          if (name.includes(term)) score += 3
          if (sig.includes(term)) score += 1
          if (name === term) score += 5
        }
        return { ...entity, score }
      })
      .filter(e => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
  }
}
