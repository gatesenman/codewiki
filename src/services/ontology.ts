/**
 * Ontology-based Code Semantic Model
 *
 * Builds an RDF-like knowledge graph from code analysis.
 * Entities: Module, Class, Function, Interface, etc.
 * Relations: imports, extends, implements, calls, contains, etc.
 *
 * Key improvements over v1:
 * - Methods linked to parent class/interface via "contains" relation
 * - Scoped entity IDs (filePath::className::methodName) to avoid name collisions
 * - Decorator and React component extraction
 * - Optimized call detection via pre-built name index
 * - More robust block-end detection (skips strings and comments)
 */

import { v4 as uuid } from 'uuid'
import type {
  OntologyEntity, OntologyRelation, OntologyGraph,
  OntologyEntityType, OntologyRelationType, FileNode,
  GraphNode, GraphLink,
} from '../types'
import { extractTsAst, isAstSupported } from './ts-ast-extractor'
import {
  ensureTreeSitter,
  isTreeSitterSupported,
  isTreeSitterReady,
  extractTreeSitter,
} from './treesitter-extractor'

export interface OntologyExtractionOptions {
  /** Include arrow functions / React components as entities. */
  extractArrowFunctions: boolean
  /** Keep decorator prefixes (e.g. `@Component(...)`) in entity signatures. */
  extractDecorators: boolean
}

const DEFAULT_EXTRACTION_OPTIONS: OntologyExtractionOptions = {
  extractArrowFunctions: true,
  extractDecorators: true,
}

// Regex patterns for extracting code entities from different languages
const PATTERNS = {
  classDecl: [
    /(?:@\w+(?:\([^)]*\))?\s*)*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+)(?:<[^>]+>)?)?(?:\s+implements\s+([\w,\s<>]+))?/g,
    /class\s+(\w+)(?:\(([^)]*)\))?:/g, // Python
  ],
  interfaceDecl: [
    /(?:export\s+)?interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+([\w,\s<>]+))?/g,
  ],
  functionDecl: [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g,
    /def\s+(\w+)\s*\(([^)]*)\)/g, // Python
    /func\s+(\w+)\s*\(([^)]*)\)/g, // Go
    /(?:pub\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g, // Rust
  ],
  // Arrow functions and React components
  arrowFunctionDecl: [
    /(?:export\s+)?const\s+(\w+)\s*(?::\s*(?:React\.)?(?:FC|FunctionComponent)(?:<[^>]+>)?)?\s*=\s*(?:async\s+)?\([^)]*\)\s*(?:=>|:)/g,
    /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/g,
    /(?:export\s+)?const\s+(\w+)\s*=\s*React\.(?:memo|forwardRef|lazy)\(/g,
  ],
  importDecl: [
    /import\s+(?:type\s+)?(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+(\w+)\s*(?:,\s*{([^}]+)})?\s+from\s+['"]([^'"]+)['"]/g,
    /from\s+(\S+)\s+import\s+(.+)/g, // Python
    /import\s+\(\s*"([^"]+)"\s*\)/g, // Go
    /use\s+([\w:]+)/g, // Rust
  ],
  typeDecl: [
    /(?:export\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=/g,
    /(?:export\s+)?enum\s+(\w+)/g,
  ],
  methodDecl: [
    /(?:(?:public|private|protected|static|readonly|override|abstract|async)\s+)*(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|&,\s]+)?\s*{/g,
    /(?:abstract)\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|&, \t]+)?/g,
  ],
}

// Names to skip when extracting methods (common keywords and control flow)
const SKIP_METHOD_NAMES = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch',
  'finally', 'return', 'throw', 'new', 'delete', 'typeof', 'instanceof',
  'void', 'function', 'class', 'interface', 'constructor', 'super',
  'import', 'export', 'from', 'default', 'const', 'let', 'var',
  'await', 'async', 'yield', 'break', 'continue',
])

export class OntologyBuilder {
  private entities: Map<string, OntologyEntity> = new Map()
  private relations: OntologyRelation[] = []
  private fileModuleMap: Map<string, string> = new Map()
  // Scope tracking: maps qualifiedName -> entityId
  private qualifiedNameMap: Map<string, string> = new Map()
  private deferredRelations: Array<{ sourceId: string; targetName: string; type: OntologyRelationType }> = []
  // Import specifiers captured by the AST extractor, keyed by file path.
  private astImports: Map<string, string[]> = new Map()
  private options: OntologyExtractionOptions = { ...DEFAULT_EXTRACTION_OPTIONS }

  /** Configure which optional constructs are extracted (from `ontology` settings). */
  setOptions(options: Partial<OntologyExtractionOptions>) {
    this.options = { ...this.options, ...options }
  }

  /**
   * Build ontology graph from a file tree and file contents
   */
  async buildFromFiles(
    files: FileNode[],
    readFile: (path: string) => Promise<string | null>
  ): Promise<OntologyGraph> {
    this.entities.clear()
    this.relations = []
    this.fileModuleMap.clear()
    this.qualifiedNameMap.clear()
    this.deferredRelations = []
    this.astImports.clear()

    const flatFiles = this.flattenFiles(files)

    // Pre-init tree-sitter for multi-language AST; non-blocking, falls back to regex.
    await ensureTreeSitter()

    // Phase 1: Extract entities from each file
    for (const file of flatFiles) {
      if (file.type !== 'file') continue
      const content = await readFile(file.path)
      if (!content) continue
      await this.extractEntities(file, content)
    }

    // Phase 2: Resolve relations (imports, calls, etc.)
    // Pre-build function name index for O(1) lookups instead of O(n²)
    const functionNameIndex = new Map<string, OntologyEntity[]>()
    for (const entity of this.entities.values()) {
      if (entity.type === 'Function' || entity.type === 'Method' || entity.type === 'Component') {
        const list = functionNameIndex.get(entity.name) || []
        list.push(entity)
        functionNameIndex.set(entity.name, list)
      }
    }

    for (const file of flatFiles) {
      if (file.type !== 'file') continue
      const content = await readFile(file.path)
      if (!content) continue
      this.extractRelations(file, content, functionNameIndex)
    }

    return {
      entities: Array.from(this.entities.values()),
      relations: this.relations,
    }
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

  private async extractEntities(file: FileNode, content: string) {
    const lines = content.split('\n')
    const filePath = file.path

    // Create file-level module entity
    const moduleId = uuid()
    const moduleEntity: OntologyEntity = {
      id: moduleId,
      name: file.name,
      type: 'File',
      filePath,
      line: 1,
      endLine: lines.length,
    }
    this.entities.set(moduleId, moduleEntity)
    this.fileModuleMap.set(filePath, moduleId)
    this.qualifiedNameMap.set(`${filePath}::${file.name}`, moduleId)

    // Prefer precise AST extraction for TS/JS; fall back to regex otherwise.
    const ext = file.extension || file.name.split('.').pop()
    if (isAstSupported(ext)) {
      try {
        this.extractEntitiesFromAst(file, content, moduleId, ext as string)
        return
      } catch {
        // Parser failed (e.g. exotic syntax) — fall through to regex extraction.
      }
    }

    // Try tree-sitter for non-TS/JS languages (Python, Go, Java, Rust, C#, etc.)
    if (isTreeSitterReady() && isTreeSitterSupported(ext)) {
      try {
        const result = await extractTreeSitter(content, file.name, ext as string)
        if (result) {
          this.extractEntitiesFromAst(file, content, moduleId, ext as string, result)
          return
        }
      } catch {
        // tree-sitter failed — fall through to regex.
      }
    }

    // Track class ranges for method-to-class association
    const classRanges: Array<{ id: string; name: string; startLine: number; endLine: number }> = []

    // Extract classes
    for (const pattern of PATTERNS.classDecl) {
      let match
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((match = regex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length
        const entityId = uuid()
        const endLine = this.findBlockEnd(lines, lineNum - 1)
        const entity: OntologyEntity = {
          id: entityId,
          name: match[1],
          type: 'Class',
          filePath,
          line: lineNum,
          endLine,
          signature: match[0].replace(/\s+/g, ' ').trim(),
        }
        this.entities.set(entityId, entity)
        this.qualifiedNameMap.set(`${filePath}::${match[1]}`, entityId)

        classRanges.push({ id: entityId, name: match[1], startLine: lineNum, endLine })

        this.relations.push({
          id: uuid(),
          source: moduleId,
          target: entityId,
          type: 'contains',
        })

        // extends
        if (match[2]) {
          this.addDeferredRelation(entityId, match[2].trim(), 'extends')
        }
        // implements
        if (match[3]) {
          const interfaces = match[3].split(',').map((s: string) => s.replace(/<[^>]+>/g, '').trim())
          for (const iface of interfaces) {
            if (iface) this.addDeferredRelation(entityId, iface, 'implements')
          }
        }
      }
    }

    // Extract interfaces
    for (const pattern of PATTERNS.interfaceDecl) {
      let match
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((match = regex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length
        const entityId = uuid()
        const endLine = this.findBlockEnd(lines, lineNum - 1)
        this.entities.set(entityId, {
          id: entityId,
          name: match[1],
          type: 'Interface',
          filePath,
          line: lineNum,
          endLine,
          signature: match[0].replace(/\s+/g, ' ').trim(),
        })
        this.qualifiedNameMap.set(`${filePath}::${match[1]}`, entityId)
        this.relations.push({
          id: uuid(),
          source: moduleId,
          target: entityId,
          type: 'contains',
        })

        // Interface extends
        if (match[2]) {
          const parents = match[2].split(',').map((s: string) => s.replace(/<[^>]+>/g, '').trim())
          for (const parent of parents) {
            if (parent) this.addDeferredRelation(entityId, parent, 'extends')
          }
        }
      }
    }

    // Extract top-level functions (not inside classes)
    for (const pattern of PATTERNS.functionDecl) {
      let match
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((match = regex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length

        // Skip if inside a class range (will be extracted as method)
        const insideClass = classRanges.find(
          c => lineNum >= c.startLine && lineNum <= c.endLine
        )
        if (insideClass) continue

        const entityId = uuid()
        this.entities.set(entityId, {
          id: entityId,
          name: match[1],
          type: 'Function',
          filePath,
          line: lineNum,
          endLine: this.findBlockEnd(lines, lineNum - 1),
          signature: match[0].replace(/\s+/g, ' ').trim(),
        })
        this.qualifiedNameMap.set(`${filePath}::${match[1]}`, entityId)
        this.relations.push({
          id: uuid(),
          source: moduleId,
          target: entityId,
          type: 'contains',
        })
      }
    }

    // Extract arrow functions and React components
    for (const pattern of (this.options.extractArrowFunctions ? PATTERNS.arrowFunctionDecl : [])) {
      let match
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((match = regex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length
        const name = match[1]

        // Skip if already captured as a regular function
        if (this.qualifiedNameMap.has(`${filePath}::${name}`)) continue

        // Skip if inside a class
        const insideClass = classRanges.find(
          c => lineNum >= c.startLine && lineNum <= c.endLine
        )
        if (insideClass) continue

        const isComponent = /^[A-Z]/.test(name)
        const entityId = uuid()
        this.entities.set(entityId, {
          id: entityId,
          name,
          type: isComponent ? 'Component' : 'Function',
          filePath,
          line: lineNum,
          endLine: this.findBlockEnd(lines, lineNum - 1),
          signature: match[0].replace(/\s+/g, ' ').trim(),
        })
        this.qualifiedNameMap.set(`${filePath}::${name}`, entityId)
        this.relations.push({
          id: uuid(),
          source: moduleId,
          target: entityId,
          type: 'contains',
        })
      }
    }

    // Extract methods inside classes (including abstract methods without body)
    for (const classRange of classRanges) {
      const classContent = lines.slice(classRange.startLine - 1, classRange.endLine).join('\n')
      const seenMethods = new Set<string>()
      for (const pattern of PATTERNS.methodDecl) {
        let match
        const regex = new RegExp(pattern.source, pattern.flags)
        while ((match = regex.exec(classContent)) !== null) {
          const name = match[1]
          if (SKIP_METHOD_NAMES.has(name)) continue
          if (seenMethods.has(name)) continue
          seenMethods.add(name)

          const methodLineInClass = classContent.substring(0, match.index).split('\n').length
          const absoluteLine = classRange.startLine + methodLineInClass - 1
          const entityId = uuid()
          this.entities.set(entityId, {
            id: entityId,
            name,
            type: 'Method',
            filePath,
            line: absoluteLine,
            endLine: this.findBlockEnd(lines, absoluteLine - 1),
            signature: match[0].replace(/\s+/g, ' ').trim(),
          })
          this.qualifiedNameMap.set(
            `${filePath}::${classRange.name}::${name}`, entityId
          )
          // Method belongs to its class
          this.relations.push({
            id: uuid(),
            source: classRange.id,
            target: entityId,
            type: 'contains',
          })
        }
      }
    }

    // Extract types/enums
    for (const pattern of PATTERNS.typeDecl) {
      let match
      const regex = new RegExp(pattern.source, pattern.flags)
      while ((match = regex.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split('\n').length
        const entityId = uuid()
        const isEnum = match[0].includes('enum')
        this.entities.set(entityId, {
          id: entityId,
          name: match[1],
          type: isEnum ? 'Enum' : 'Type',
          filePath,
          line: lineNum,
          endLine: this.findBlockEnd(lines, lineNum - 1),
        })
        this.qualifiedNameMap.set(`${filePath}::${match[1]}`, entityId)
        this.relations.push({
          id: uuid(),
          source: moduleId,
          target: entityId,
          type: 'contains',
        })
      }
    }
  }

  /**
   * AST-driven entity extraction for TS/JS (or tree-sitter for other langs).
   * Produces the same entity/relation shape as the regex path (module `contains`
   * entity, methods `contains`-ed by their class, deferred extends/implements),
   * but with compiler-grade accuracy.
   *
   * When `precomputed` is passed (from tree-sitter), it is used directly instead
   * of calling the TypeScript compiler AST extractor.
   */
  private extractEntitiesFromAst(
    file: FileNode,
    content: string,
    moduleId: string,
    ext: string,
    precomputed?: import('./ts-ast-extractor').AstExtractResult,
  ) {
    const filePath = file.path
    const { entities, imports } = precomputed ?? extractTsAst(content, file.name, ext, this.options)
    this.astImports.set(filePath, imports)

    // Pass 1: create non-method entities so methods can resolve their parent.
    // Dedup by name: Rust `impl` blocks may emit a second Class entry just to
    // carry `implements` info for an already-declared struct.
    const classIdByName = new Map<string, string>()
    for (const e of entities) {
      if (e.type === 'Method') continue

      const existing = (e.type === 'Class' || e.type === 'Interface')
        ? classIdByName.get(e.name)
        : undefined
      if (existing) {
        // Entity already registered — just add heritage relations.
        for (const parent of e.extends || []) {
          this.addDeferredRelation(existing, parent, 'extends')
        }
        for (const iface of e.implements || []) {
          this.addDeferredRelation(existing, iface, 'implements')
        }
        continue
      }

      const entityId = uuid()
      this.entities.set(entityId, {
        id: entityId,
        name: e.name,
        type: e.type,
        filePath,
        line: e.line,
        endLine: e.endLine,
        signature: e.signature,
      })
      this.qualifiedNameMap.set(`${filePath}::${e.name}`, entityId)
      this.relations.push({ id: uuid(), source: moduleId, target: entityId, type: 'contains' })

      if (e.type === 'Class' || e.type === 'Interface') {
        classIdByName.set(e.name, entityId)
      }
      for (const parent of e.extends || []) {
        this.addDeferredRelation(entityId, parent, 'extends')
      }
      for (const iface of e.implements || []) {
        this.addDeferredRelation(entityId, iface, 'implements')
      }
    }

    // Pass 2: methods, linked to their enclosing class/interface.
    for (const e of entities) {
      if (e.type !== 'Method') continue
      const parentId = e.parentName ? classIdByName.get(e.parentName) : undefined
      const entityId = uuid()
      this.entities.set(entityId, {
        id: entityId,
        name: e.name,
        type: 'Method',
        filePath,
        line: e.line,
        endLine: e.endLine,
        signature: e.signature,
      })
      if (e.parentName) {
        this.qualifiedNameMap.set(`${filePath}::${e.parentName}::${e.name}`, entityId)
      }
      this.relations.push({
        id: uuid(),
        source: parentId || moduleId,
        target: entityId,
        type: 'contains',
      })
    }
  }

  private extractRelations(
    file: FileNode,
    content: string,
    functionNameIndex: Map<string, OntologyEntity[]>,
  ) {
    const moduleId = this.fileModuleMap.get(file.path)
    if (!moduleId) return

    // Extract import relations. Use precise AST import specifiers for TS/JS;
    // fall back to regex patterns for other languages.
    const astSpecifiers = this.astImports.get(file.path)
    if (astSpecifiers) {
      for (const importPath of astSpecifiers) {
        this.resolveImportRelation(moduleId, importPath)
      }
    } else {
      for (const pattern of PATTERNS.importDecl) {
        let match
        const regex = new RegExp(pattern.source, pattern.flags)
        while ((match = regex.exec(content)) !== null) {
          const importPath = match[3] || match[1]
          if (importPath) this.resolveImportRelation(moduleId, importPath)
        }
      }
    }

    // Extract function call relations using pre-built index
    const entities = Array.from(this.entities.values())
    const fileEntities = entities.filter(
      e => e.filePath === file.path && e.type !== 'File'
    )

    for (const entity of fileEntities) {
      const lines = content.split('\n')
      const entityContent = lines.slice(entity.line - 1, entity.endLine).join('\n')

      // Only check function names that appear in this entity's content
      for (const [funcName, targets] of functionNameIndex) {
        if (funcName === entity.name) continue
        if (funcName.length < 2) continue // Skip tiny names
        if (!entityContent.includes(funcName)) continue // Fast string check

        const callRegex = new RegExp(`\\b${funcName}\\s*\\(`, 'g')
        if (callRegex.test(entityContent)) {
          // Prefer target in same file, then fall back to any match
          const sameFileTarget = targets.find(t => t.filePath === file.path && t.id !== entity.id)
          const target = sameFileTarget || targets.find(t => t.id !== entity.id)
          if (target) {
            // Avoid duplicate relations
            const exists = this.relations.some(
              r => r.source === entity.id && r.target === target.id && r.type === 'calls'
            )
            if (!exists) {
              this.relations.push({
                id: uuid(),
                source: entity.id,
                target: target.id,
                type: 'calls',
              })
            }
          }
        }
      }
    }
  }

  /**
   * Resolve a single import specifier to a module entity and record an
   * `imports` relation. Uses strict segment-suffix matching to reduce false
   * positives, mirroring the original regex behaviour.
   */
  private resolveImportRelation(moduleId: string, importPath: string) {
    const normalizedImport = importPath.replace(/^[./]+/, '').replace(/\\/g, '/')
    if (!normalizedImport) return

    for (const [filePath, targetModuleId] of this.fileModuleMap) {
      if (targetModuleId === moduleId) continue
      const normalizedFile = filePath.replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx|py|go|rs)$/, '')

      const fileSegments = normalizedFile.split('/')
      const importSegments = normalizedImport.split('/')

      let matches = true
      for (let i = 0; i < importSegments.length; i++) {
        const fileIdx = fileSegments.length - importSegments.length + i
        if (fileIdx < 0 || fileSegments[fileIdx] !== importSegments[i]) {
          matches = false
          break
        }
      }

      if (matches) {
        this.relations.push({
          id: uuid(),
          source: moduleId,
          target: targetModuleId,
          type: 'imports',
        })
        break
      }
    }
  }

  private addDeferredRelation(sourceId: string, targetName: string, type: OntologyRelationType) {
    this.deferredRelations.push({ sourceId, targetName, type })
  }

  resolveDeferredRelations() {
    const entities = Array.from(this.entities.values())
    for (const deferred of this.deferredRelations) {
      const target = entities.find(e => e.name === deferred.targetName)
      if (target) {
        this.relations.push({
          id: uuid(),
          source: deferred.sourceId,
          target: target.id,
          type: deferred.type,
        })
      }
    }
    this.deferredRelations = []
  }

  /**
   * Find the end of a code block, skipping strings and comments.
   */
  private findBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0
    let found = false
    let inSingleQuote = false
    let inDoubleQuote = false
    let inTemplateStr = false
    let inLineComment = false
    let inBlockComment = false

    for (let i = startLine; i < lines.length && i < startLine + 500; i++) {
      const line = lines[i]
      inLineComment = false

      for (let j = 0; j < line.length; j++) {
        const ch = line[j]
        const next = j + 1 < line.length ? line[j + 1] : ''
        const prev = j > 0 ? line[j - 1] : ''

        // Skip block comments
        if (inBlockComment) {
          if (ch === '*' && next === '/') { inBlockComment = false; j++ }
          continue
        }
        // Skip line comments
        if (inLineComment) continue

        // Skip strings
        if (inSingleQuote) { if (ch === "'" && prev !== '\\') inSingleQuote = false; continue }
        if (inDoubleQuote) { if (ch === '"' && prev !== '\\') inDoubleQuote = false; continue }
        if (inTemplateStr) { if (ch === '`' && prev !== '\\') inTemplateStr = false; continue }

        // Enter comments
        if (ch === '/' && next === '/') { inLineComment = true; continue }
        if (ch === '/' && next === '*') { inBlockComment = true; j++; continue }

        // Enter strings
        if (ch === "'") { inSingleQuote = true; continue }
        if (ch === '"') { inDoubleQuote = true; continue }
        if (ch === '`') { inTemplateStr = true; continue }

        // Count braces
        if (ch === '{') { braceCount++; found = true }
        if (ch === '}') braceCount--
        if (found && braceCount === 0) return i + 1
      }

      // Python: use indentation for block detection
      if (!found && i > startLine && lines[i].trim() !== '' &&
          !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
        return i
      }
    }
    return Math.min(startLine + 50, lines.length)
  }

  /**
   * Convert ontology graph to D3 visualization format
   */
  static toGraphVisualization(graph: OntologyGraph): { nodes: GraphNode[]; links: GraphLink[] } {
    const typeGroups: Record<OntologyEntityType, number> = {
      'Package': 0, 'Module': 1, 'File': 1, 'Class': 2,
      'Interface': 3, 'Function': 4, 'Method': 5,
      'Variable': 6, 'Type': 7, 'Enum': 8, 'Component': 9,
    }

    const nodes: GraphNode[] = graph.entities.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      filePath: e.filePath,
      group: typeGroups[e.type] ?? 0,
    }))

    const nodeIds = new Set(nodes.map(n => n.id))
    const links: GraphLink[] = graph.relations
      .filter(r => nodeIds.has(r.source) && nodeIds.has(r.target))
      .map(r => ({
        source: r.source,
        target: r.target,
        type: r.type,
        value: 1,
      }))

    return { nodes, links }
  }

  /**
   * Impact analysis: given an entity, find all entities that might be affected by changes.
   * Distinguishes relation types for smarter traversal.
   */
  static getImpactedEntities(
    entityId: string,
    graph: OntologyGraph,
    depth: number = 3
  ): Set<string> {
    const impacted = new Set<string>()
    const queue = [{ id: entityId, d: 0 }]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.d > depth) continue
      if (impacted.has(current.id)) continue
      impacted.add(current.id)

      const reverseRelations = graph.relations.filter(
        r => r.target === current.id || r.source === current.id
      )
      for (const rel of reverseRelations) {
        const nextId = rel.source === current.id ? rel.target : rel.source

        // For 'contains' relation, only propagate downward (parent → child)
        // not upward (child → parent), to avoid pulling in entire file
        if (rel.type === 'contains' && rel.target === current.id) continue

        if (!impacted.has(nextId)) {
          queue.push({ id: nextId, d: current.d + 1 })
        }
      }
    }

    return impacted
  }
}
