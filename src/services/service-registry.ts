/**
 * Service Registry — Singleton container for shared service instances.
 *
 * Solves the critical bug where ChatPanel/CodeAgentPanel create
 * empty VectorStore instances instead of reusing the indexed one.
 */

import { VectorStore } from './vector-store'
import { OntologyBuilder } from './ontology'
import { LLMService } from './llm'
import { CodeAgent } from './code-agent'
import { MCPServer } from './mcp-server'
import type { AppSettings } from '../types'

class ServiceRegistry {
  private _vectorStore: VectorStore | null = null
  private _ontologyBuilder: OntologyBuilder | null = null
  private _llmService: LLMService | null = null
  private _codeAgent: CodeAgent | null = null
  private _mcpServer: MCPServer | null = null

  get vectorStore(): VectorStore {
    if (!this._vectorStore) {
      this._vectorStore = new VectorStore()
    }
    return this._vectorStore
  }

  set vectorStore(store: VectorStore) {
    this._vectorStore = store
  }

  get ontologyBuilder(): OntologyBuilder {
    if (!this._ontologyBuilder) {
      this._ontologyBuilder = new OntologyBuilder()
    }
    return this._ontologyBuilder
  }

  set ontologyBuilder(builder: OntologyBuilder) {
    this._ontologyBuilder = builder
  }

  getLLMService(settings: AppSettings): LLMService {
    if (!this._llmService) {
      this._llmService = new LLMService(settings)
    } else {
      this._llmService.updateSettings(settings)
    }
    return this._llmService
  }

  getCodeAgent(settings: AppSettings): CodeAgent {
    const llm = this.getLLMService(settings)
    if (!this._codeAgent) {
      this._codeAgent = new CodeAgent(llm, this.vectorStore)
    }
    return this._codeAgent
  }

  get mcpServer(): MCPServer {
    if (!this._mcpServer) {
      this._mcpServer = new MCPServer()
    }
    return this._mcpServer
  }

  /**
   * Reset all services (e.g. when switching projects)
   */
  reset() {
    this._vectorStore = null
    this._ontologyBuilder = null
    this._codeAgent = null
    // Keep LLM service and MCP server
  }
}

export const services = new ServiceRegistry()
