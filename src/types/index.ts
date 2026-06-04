// File system types
export interface FileNode {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
  size?: number
}

// Ontology types (RDF-based code knowledge model)
export type OntologyEntityType =
  | 'Module'
  | 'Class'
  | 'Interface'
  | 'Function'
  | 'Method'
  | 'Variable'
  | 'Type'
  | 'Enum'
  | 'Package'
  | 'File'
  | 'Component'

export type OntologyRelationType =
  | 'imports'
  | 'exports'
  | 'extends'
  | 'implements'
  | 'contains'
  | 'calls'
  | 'uses'
  | 'returns'
  | 'dependsOn'
  | 'overrides'
  | 'parameterOf'

export interface OntologyEntity {
  id: string
  name: string
  type: OntologyEntityType
  filePath: string
  line: number
  endLine: number
  description?: string
  signature?: string
  properties?: Record<string, string>
}

export interface OntologyRelation {
  id: string
  source: string // entity id
  target: string // entity id
  type: OntologyRelationType
  metadata?: Record<string, string>
}

export interface OntologyGraph {
  entities: OntologyEntity[]
  relations: OntologyRelation[]
}

// Wiki types
export interface WikiPage {
  id: string
  title: string
  slug: string
  content: string // markdown
  order: number
  parentId?: string
  children?: WikiPage[]
  fileSources?: string[] // linked source files
  lastUpdated: number
}

export interface WikiProject {
  id: string
  name: string
  path: string
  type: 'local' | 'github'
  wikiPages: WikiPage[]
  ontologyGraph: OntologyGraph
  generatedAt: number
  status: 'idle' | 'indexing' | 'generating' | 'ready' | 'error'
  error?: string
}

// Search types
export interface SearchResult {
  id: string
  type: 'wiki' | 'code' | 'entity'
  title: string
  content: string
  score: number
  filePath?: string
  line?: number
  entityType?: OntologyEntityType
}

// Chat types
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  sources?: CodeSource[]
}

export interface CodeSource {
  filePath: string
  startLine: number
  endLine: number
  content: string
  relevance: number
}

// Knowledge graph visualization
export interface GraphNode {
  id: string
  name: string
  type: OntologyEntityType
  filePath: string
  group: number
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  type: OntologyRelationType
  value: number
}

// Code Agent types
export interface CodeModification {
  filePath: string
  startLine: number
  endLine: number
  originalContent: string
  newContent: string
  description: string
  affectedEntities: string[] // entity ids from ontology
}

// MCP types
export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

// Settings (legacy — kept for backward compatibility)
export interface AppSettings {
  llmProvider: 'openai' | 'anthropic' | 'deepseek' | 'ollama'
  apiKey: string
  apiBaseUrl?: string
  model: string
  embeddingModel: string
  theme: 'dark' | 'light'
  maxFileSize: number
  maxDepth: number
}

// Recent project entry
export interface RecentProject {
  id: string
  name: string
  path: string
  type: 'local' | 'github'
  lastOpened: number
  entityCount?: number
  fileCount?: number
}

// Electron API bridge
export interface ModificationResult {
  success: boolean
  error?: string
  backupPath?: string
  expected?: string
  actual?: string
}

export interface ElectronAPI {
  selectFolder: () => Promise<string | null>
  readDirectory: (dirPath: string) => Promise<FileNode[]>
  readFile: (filePath: string) => Promise<string | null>
  writeFile: (filePath: string, content: string) => Promise<ModificationResult>
  applyModification: (
    filePath: string, startLine: number, endLine: number,
    newContent: string, expectedOriginal: string,
  ) => Promise<ModificationResult>
  openExternal: (url: string) => Promise<void>
  getAppDataPath: () => Promise<string>
  saveWikiData: (projectId: string, data: string) => Promise<boolean>
  loadWikiData: (projectId: string) => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
