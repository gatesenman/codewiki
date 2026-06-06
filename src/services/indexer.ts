/**
 * Code Indexer Service
 * 
 * Indexes code files from a local folder or GitHub repository.
 * Builds:
 * 1. File tree structure
 * 2. Ontology graph (entities + relations)
 * 3. Vector embeddings for semantic search
 */

import { v4 as uuid } from 'uuid'
import type { FileNode, WikiProject, OntologyGraph } from '../types'
import { OntologyBuilder } from './ontology'
import {
  VectorStore, OpenAIEmbeddingProvider, OllamaEmbeddingProvider,
  type EmbeddingProvider,
} from './vector-store'
import { services } from './service-registry'
import { configManager } from './config-manager'

export interface IndexProgress {
  phase: 'scanning' | 'parsing' | 'ontology' | 'embedding' | 'complete'
  current: number
  total: number
  message: string
}

export class CodeIndexer {
  private ontologyBuilder: OntologyBuilder
  private vectorStore: VectorStore

  constructor() {
    // Use global service registry so indexed data is shared across all components
    this.ontologyBuilder = services.ontologyBuilder
    this.vectorStore = services.vectorStore
  }

  /**
   * Index a local project folder
   */
  async indexLocalProject(
    folderPath: string,
    onProgress?: (progress: IndexProgress) => void
  ): Promise<WikiProject> {
    const projectId = uuid()
    const projectName = folderPath.split(/[/\\]/).pop() || 'project'

    onProgress?.({
      phase: 'scanning',
      current: 0,
      total: 0,
      message: 'Scanning directory structure...',
    })

    // Read directory tree via Electron IPC
    const files = await window.electronAPI.readDirectory(folderPath)

    const flatFiles = this.flattenFiles(files)
    const codeFiles = flatFiles.filter(f => f.type === 'file')

    onProgress?.({
      phase: 'parsing',
      current: 0,
      total: codeFiles.length,
      message: `Found ${codeFiles.length} code files. Parsing...`,
    })

    // Build ontology graph
    onProgress?.({
      phase: 'ontology',
      current: 0,
      total: codeFiles.length,
      message: 'Building code ontology model...',
    })

    const readFile = async (path: string) => {
      return await window.electronAPI.readFile(path)
    }

    const ontologyGraph = await this.ontologyBuilder.buildFromFiles(files, readFile)
    this.ontologyBuilder.resolveDeferredRelations()

    // Build vector embeddings for semantic search
    onProgress?.({
      phase: 'embedding',
      current: 0,
      total: codeFiles.length,
      message: 'Creating vector embeddings for semantic search...',
    })

    for (let i = 0; i < codeFiles.length; i++) {
      const file = codeFiles[i]
      const content = await readFile(file.path)
      if (content) {
        await this.vectorStore.addDocument({
          id: file.path,
          content: content.substring(0, 8000), // truncate very large files
          metadata: {
            filePath: file.relativePath,
            fileName: file.name,
            extension: file.extension || '',
          },
        })
      }
      onProgress?.({
        phase: 'embedding',
        current: i + 1,
        total: codeFiles.length,
        message: `Indexing ${file.relativePath}...`,
      })
    }

    await this.maybeBuildEmbeddings(onProgress)

    onProgress?.({
      phase: 'complete',
      current: codeFiles.length,
      total: codeFiles.length,
      message: 'Indexing complete!',
    })

    const project: WikiProject = {
      id: projectId,
      name: projectName,
      path: folderPath,
      type: 'local',
      wikiPages: [],
      ontologyGraph,
      generatedAt: Date.now(),
      status: 'ready',
    }

    return project
  }

  /**
   * Index a GitHub repository by URL
   */
  async indexGitHubRepo(
    repoUrl: string,
    onProgress?: (progress: IndexProgress) => void
  ): Promise<WikiProject> {
    // Parse GitHub URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) throw new Error('Invalid GitHub URL')

    const [, owner, repo] = match
    const projectId = uuid()

    onProgress?.({
      phase: 'scanning',
      current: 0,
      total: 0,
      message: `Fetching repository ${owner}/${repo}...`,
    })

    // Fetch repo contents via GitHub API
    const tree = await this.fetchGitHubTree(owner, repo)
    const flatFiles = this.flattenFiles(tree)
    const codeFiles = flatFiles.filter(f => f.type === 'file')

    onProgress?.({
      phase: 'ontology',
      current: 0,
      total: codeFiles.length,
      message: 'Building code ontology model...',
    })

    // Fetch file contents and build ontology for GitHub repos
    const fileContents = new Map<string, string>()
    const readFile = async (path: string): Promise<string | null> => {
      if (fileContents.has(path)) return fileContents.get(path)!
      try {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}/contents/${path}`,
          { headers: { 'Accept': 'application/vnd.github.raw' } }
        )
        if (!resp.ok) return null
        const content = await resp.text()
        fileContents.set(path, content)
        return content
      } catch { return null }
    }

    const ontologyGraph = await this.ontologyBuilder.buildFromFiles(tree, readFile)
    this.ontologyBuilder.resolveDeferredRelations()

    // Build vector embeddings
    onProgress?.({
      phase: 'embedding',
      current: 0,
      total: codeFiles.length,
      message: 'Creating vector embeddings...',
    })

    for (let i = 0; i < codeFiles.length; i++) {
      const file = codeFiles[i]
      const content = await readFile(file.path)
      if (content) {
        await this.vectorStore.addDocument({
          id: file.path,
          content: content.substring(0, 8000),
          metadata: {
            filePath: file.relativePath,
            fileName: file.name,
            extension: file.extension || '',
          },
        })
      }
      onProgress?.({
        phase: 'embedding',
        current: i + 1,
        total: codeFiles.length,
        message: `Indexing ${file.relativePath}...`,
      })
    }

    await this.maybeBuildEmbeddings(onProgress)

    onProgress?.({
      phase: 'complete',
      current: codeFiles.length,
      total: codeFiles.length,
      message: 'GitHub repository indexed!',
    })

    const project: WikiProject = {
      id: projectId,
      name: `${owner}/${repo}`,
      path: repoUrl,
      type: 'github',
      wikiPages: [],
      ontologyGraph,
      generatedAt: Date.now(),
      status: 'ready',
    }

    return project
  }

  private async fetchGitHubTree(owner: string, repo: string): Promise<FileNode[]> {
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
      )
      const data = await resp.json()
      if (!data.tree) return []

      // Convert flat tree to nested FileNode structure
      const root: FileNode[] = []
      const dirMap = new Map<string, FileNode>()

      for (const item of data.tree) {
        if (item.type === 'blob') {
          const parts = item.path.split('/')
          const fileName = parts.pop()!
          const dirPath = parts.join('/')

          const fileNode: FileNode = {
            name: fileName,
            path: item.path,
            relativePath: item.path,
            type: 'file',
            extension: '.' + fileName.split('.').pop(),
            size: item.size,
          }

          if (dirPath === '') {
            root.push(fileNode)
          } else {
            const parent = dirMap.get(dirPath)
            if (parent) {
              if (!parent.children) parent.children = []
              parent.children.push(fileNode)
            }
          }
        } else if (item.type === 'tree') {
          const dirNode: FileNode = {
            name: item.path.split('/').pop()!,
            path: item.path,
            relativePath: item.path,
            type: 'directory',
            children: [],
          }
          dirMap.set(item.path, dirNode)

          const parts = item.path.split('/')
          if (parts.length === 1) {
            root.push(dirNode)
          } else {
            const parentPath = parts.slice(0, -1).join('/')
            const parent = dirMap.get(parentPath)
            if (parent) {
              if (!parent.children) parent.children = []
              parent.children.push(dirNode)
            }
          }
        }
      }

      return root
    } catch (err) {
      console.error('Failed to fetch GitHub tree:', err)
      return []
    }
  }

  getVectorStore(): VectorStore {
    return this.vectorStore
  }

  /**
   * Build an embedding provider from the current config, or undefined when
   * hybrid retrieval is disabled or no embedding-capable backend is available.
   */
  private buildEmbeddingProvider(): EmbeddingProvider | undefined {
    const config = configManager.getConfig()
    if (!config.search.useEmbeddings) return undefined
    const llm = config.llm
    if (llm.provider === 'ollama') {
      return new OllamaEmbeddingProvider({
        model: llm.embeddingModel,
        baseURL: llm.apiBaseUrl || undefined,
      })
    }
    if (llm.apiKey) {
      return new OpenAIEmbeddingProvider({
        apiKey: llm.apiKey,
        model: llm.embeddingModel,
        baseURL: llm.apiBaseUrl || undefined,
      })
    }
    return undefined
  }

  /**
   * Optionally compute dense embeddings for the indexed documents so that
   * `searchHybrid` can fuse semantic + keyword results. Resilient: any failure
   * (e.g. Ollama not running, network error) leaves the store in TF-IDF mode.
   */
  private async maybeBuildEmbeddings(
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<void> {
    const provider = this.buildEmbeddingProvider()
    if (!provider) {
      this.vectorStore.setEmbeddingProvider(undefined)
      return
    }
    this.vectorStore.setEmbeddingProvider(provider)
    onProgress?.({
      phase: 'embedding',
      current: 0,
      total: 0,
      message: 'Computing semantic embeddings (hybrid search)...',
    })
    try {
      const count = await this.vectorStore.embedDocuments()
      onProgress?.({
        phase: 'embedding',
        current: count,
        total: count,
        message: `Computed embeddings for ${count} documents.`,
      })
    } catch (err) {
      console.warn('[indexer] Embedding generation failed; using TF-IDF only.', err)
      this.vectorStore.setEmbeddingProvider(undefined)
    }
  }

  getOntologyBuilder(): OntologyBuilder {
    return this.ontologyBuilder
  }

  private flattenFiles(nodes: FileNode[]): FileNode[] {
    const result: FileNode[] = []
    for (const node of nodes) {
      result.push(node)
      if (node.children) {
        result.push(...this.flattenFiles(node.children))
      }
    }
    return result
  }
}
