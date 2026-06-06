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
import { parseLsif, mergeLsifIntoGraph, LSIF_CANDIDATES } from './lsif-consumer'
import {
  isMonorepo, resolvePackages, integrateWorkspaces, isPackageJson, WORKSPACE_FILES,
} from './workspace-resolver'
import { createPrivacyFilter, CODEWIKIIGNORE_FILE, type PrivacyFilter } from './privacy-filter'
import {
  cacheKeyFor, buildManifest, diffManifest, isClean,
  loadSnapshot, saveSnapshot, INDEX_SNAPSHOT_VERSION,
  type FileManifest,
} from './index-cache'

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
    onProgress?: (progress: IndexProgress) => void,
    options?: { forceFull?: boolean }
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
    const rawFiles = await window.electronAPI.readDirectory(folderPath)

    // Honor .codewikiignore + default-sensitive files: drop ignored paths from
    // the tree and redact secrets from any content that leaves the machine.
    const ignoreText = await window.electronAPI
      .readFile(folderPath + (folderPath.includes('\\') ? '\\' : '/') + CODEWIKIIGNORE_FILE)
      .catch(() => null)
    const privacy = createPrivacyFilter(ignoreText)
    const files = this.filterTree(rawFiles, folderPath, privacy)

    const flatFiles = this.flattenFiles(files)
    const codeFiles = flatFiles.filter(f => f.type === 'file')
    const fileByPath = new Map(codeFiles.map(f => [f.path, f]))

    const readFile = async (path: string) => {
      const content = await window.electronAPI.readFile(path)
      return content === null || content === undefined ? content : privacy.redact(content)
    }
    const addDoc = async (file: FileNode) => {
      const content = await readFile(file.path)
      if (!content) return
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

    const cacheKey = cacheKeyFor(folderPath)
    const manifest = buildManifest(files)

    // Attempt to reuse a persisted snapshot to avoid a full re-index.
    if (!options?.forceFull) {
      const snapshot = await loadSnapshot(cacheKey)
      if (snapshot && snapshot.type === 'local') {
        const diff = diffManifest(snapshot.manifest, manifest)
        const reused = snapshot.manifest
          ? Object.keys(snapshot.manifest).length - diff.deleted.length
          : 0

        if (isClean(diff)) {
          onProgress?.({
            phase: 'parsing', current: 0, total: 0,
            message: 'No changes detected — restoring index from cache...',
          })
          await this.vectorStore.import(snapshot.vectors)
          await this.maybeBuildEmbeddings(onProgress) // no-op if already embedded
          onProgress?.({
            phase: 'complete', current: codeFiles.length, total: codeFiles.length,
            message: `Restored ${codeFiles.length} files from cache.`,
          })
          return this.buildProject(projectId, projectName, folderPath, 'local', snapshot.ontologyGraph)
        }

        // Incremental: reuse unchanged docs/embeddings, refresh the rest.
        onProgress?.({
          phase: 'embedding', current: 0, total: 0,
          message: `Incremental update: ${diff.changed.length} changed, ${diff.added.length} added, ${diff.deleted.length} removed (${reused} reused)...`,
        })
        await this.vectorStore.import(snapshot.vectors)
        for (const p of diff.deleted) this.vectorStore.removeDocument(p)
        for (const p of [...diff.changed, ...diff.added]) {
          this.vectorStore.removeDocument(p) // drop stale embedding for changed files
          const file = fileByPath.get(p)
          if (file) await addDoc(file)
        }
        this.vectorStore.rebuildIndex()

        // Ontology is rebuilt fully (CPU-only) to guarantee graph correctness.
        const ontologyGraph = await this.ontologyBuilder.buildFromFiles(files, readFile)
        this.ontologyBuilder.resolveDeferredRelations()
        await this.enrichWithLsif(folderPath, ontologyGraph, readFile)
        await this.enrichWithWorkspaces(folderPath, files, ontologyGraph, readFile)
        await this.maybeBuildEmbeddings(onProgress) // embeds only changed/added docs

        await this.persistSnapshot(cacheKey, projectName, folderPath, 'local', manifest, ontologyGraph)
        onProgress?.({
          phase: 'complete', current: codeFiles.length, total: codeFiles.length,
          message: 'Incremental indexing complete!',
        })
        return this.buildProject(projectId, projectName, folderPath, 'local', ontologyGraph)
      }
    }

    // Full index (no cache, or forced).
    onProgress?.({
      phase: 'parsing',
      current: 0,
      total: codeFiles.length,
      message: `Found ${codeFiles.length} code files. Parsing...`,
    })
    onProgress?.({
      phase: 'ontology',
      current: 0,
      total: codeFiles.length,
      message: 'Building code ontology model...',
    })

    this.vectorStore.clear()
    const ontologyGraph = await this.ontologyBuilder.buildFromFiles(files, readFile)
    this.ontologyBuilder.resolveDeferredRelations()
    await this.enrichWithLsif(folderPath, ontologyGraph, readFile, onProgress)
    await this.enrichWithWorkspaces(folderPath, files, ontologyGraph, readFile, onProgress)

    onProgress?.({
      phase: 'embedding',
      current: 0,
      total: codeFiles.length,
      message: 'Creating vector embeddings for semantic search...',
    })

    for (let i = 0; i < codeFiles.length; i++) {
      await addDoc(codeFiles[i])
      onProgress?.({
        phase: 'embedding',
        current: i + 1,
        total: codeFiles.length,
        message: `Indexing ${codeFiles[i].relativePath}...`,
      })
    }

    await this.maybeBuildEmbeddings(onProgress)
    await this.persistSnapshot(cacheKey, projectName, folderPath, 'local', manifest, ontologyGraph)

    onProgress?.({
      phase: 'complete',
      current: codeFiles.length,
      total: codeFiles.length,
      message: 'Indexing complete!',
    })

    return this.buildProject(projectId, projectName, folderPath, 'local', ontologyGraph)
  }

  /**
   * If the project ships a textual LSIF dump, consume it to add
   * compiler-accurate calls/uses relations on top of the heuristic ontology.
   * No-op (and silent) when no dump is present or it can't be parsed.
   */
  private async enrichWithLsif(
    folderPath: string,
    graph: OntologyGraph,
    readFile: (path: string) => Promise<string | null>,
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<void> {
    const sep = folderPath.includes('\\') ? '\\' : '/'
    for (const candidate of LSIF_CANDIDATES) {
      const full = folderPath + sep + candidate.replace(/\//g, sep)
      let text: string | null = null
      try {
        text = await readFile(full)
      } catch {
        text = null
      }
      if (!text) continue
      try {
        const parsed = parseLsif(text)
        const stats = mergeLsifIntoGraph(graph, parsed.symbols)
        onProgress?.({
          phase: 'ontology', current: 0, total: 0,
          message: `LSIF index found (${candidate}): +${stats.added} compiler-accurate relations.`,
        })
      } catch {
        // Malformed dump — keep the heuristic graph as-is.
      }
      return // first existing candidate wins
    }
  }

  /**
   * Detect monorepo workspaces and lift the ontology to the package level
   * (Package nodes, contains edges, cross-package dependsOn). No-op for a
   * single-package repo, so non-monorepo projects are unaffected.
   */
  private async enrichWithWorkspaces(
    folderPath: string,
    files: FileNode[],
    graph: OntologyGraph,
    readFile: (path: string) => Promise<string | null>,
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<void> {
    const sep = folderPath.includes('\\') ? '\\' : '/'
    const rootNorm = folderPath.replace(/\\/g, '/').replace(/\/+$/, '')

    const pkgPaths = this.flattenFiles(files)
      .filter(f => f.type === 'file' && isPackageJson(f.path))
      .map(f => f.path)
    if (!pkgPaths.length) return

    const pkgJsonByPath = new Map<string, string>()
    let rootPkg: string | null = null
    for (const p of pkgPaths) {
      const content = await readFile(p).catch(() => null)
      if (!content) continue
      pkgJsonByPath.set(p, content)
      if (p.replace(/\\/g, '/').replace(/\/+$/, '') === rootNorm + '/package.json') rootPkg = content
    }

    let hasWorkspaceFile = false
    for (const wf of WORKSPACE_FILES) {
      const probe = await readFile(folderPath + sep + wf).catch(() => null)
      if (probe) { hasWorkspaceFile = true; break }
    }

    if (!isMonorepo({ rootPackageJson: rootPkg, hasWorkspaceFile, packageJsonCount: pkgJsonByPath.size })) return

    const packages = resolvePackages(pkgJsonByPath, folderPath)
    const stats = integrateWorkspaces(graph, packages)
    onProgress?.({
      phase: 'ontology', current: 0, total: 0,
      message: `Monorepo detected: ${stats.packages} packages, ${stats.dependsOn} cross-package dependencies.`,
    })
  }

  private buildProject(
    id: string, name: string, path: string,
    type: 'local' | 'github', ontologyGraph: OntologyGraph,
  ): WikiProject {
    return {
      id, name, path, type,
      wikiPages: [],
      ontologyGraph,
      generatedAt: Date.now(),
      status: 'ready',
    }
  }

  /** Save an index snapshot for fast reopen; best-effort (no-op without bridge). */
  private async persistSnapshot(
    cacheKey: string, name: string, path: string,
    type: 'local' | 'github', manifest: FileManifest, ontologyGraph: OntologyGraph,
  ): Promise<void> {
    await saveSnapshot({
      version: INDEX_SNAPSHOT_VERSION,
      cacheKey, name, path, type,
      generatedAt: Date.now(),
      manifest,
      ontologyGraph,
      vectors: this.vectorStore.export(),
    })
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

  /**
   * Drop paths matched by `.codewikiignore` / default-sensitive globs from the
   * file tree, so ignored content is never parsed, embedded, or exposed.
   */
  private filterTree(nodes: FileNode[], rootPath: string, privacy: PrivacyFilter): FileNode[] {
    const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const rel = (full: string) => full.replace(/\\/g, '/').replace(root + '/', '')
    const walk = (list: FileNode[]): FileNode[] => {
      const out: FileNode[] = []
      for (const node of list) {
        if (privacy.isIgnored(rel(node.path), node.type === 'directory')) continue
        if (node.type === 'directory') {
          const children = node.children ? walk(node.children) : []
          if (children.length) out.push({ ...node, children })
        } else {
          out.push(node)
        }
      }
      return out
    }
    return walk(nodes)
  }
}
