/**
 * Multi-language AST extraction using web-tree-sitter (WASM).
 *
 * Supports Python, Go, Java, Rust, C#, Ruby, PHP, Kotlin, and Swift.
 * Produces the same {@link AstExtractResult} shape as the TS/JS extractor so
 * ontology.ts can consume it identically.
 *
 * Two modes of operation:
 *  - **Node** (CLI / MCP / test harness): locates grammars on disk via
 *    `require.resolve` — zero config.
 *  - **Browser** (Vite / Electron renderer): the app registers grammar URLs
 *    via {@link registerGrammarUrls} before first parse; otherwise tree-sitter
 *    is unavailable and callers fall back to regex.
 *
 * All public surface is async-safe and never throws — if wasm loading fails
 * the module reports "not ready" and callers use regex.
 */

import type { AstEntity, AstExtractResult } from './ts-ast-extractor'

// ---------------------------------------------------------------------------
// web-tree-sitter types (subset we use — avoids coupling to the CJS export shape)
// ---------------------------------------------------------------------------
interface TSParser {
  setLanguage(lang: TSLanguage): void
  parse(input: string): TSTree
}
interface TSTree { rootNode: TSNode }
interface TSNode {
  type: string
  text: string
  namedChildCount: number
  namedChild(i: number): TSNode
  childForFieldName(name: string): TSNode | null
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
}
interface TSLanguage {}
interface TSParserCtor {
  new (): TSParser
  init(opts?: { locateFile?: (name: string) => string }): Promise<void>
  Language: { load(pathOrUrl: string): Promise<TSLanguage> }
}

// ---------------------------------------------------------------------------
// Language → grammar wasm mapping
// ---------------------------------------------------------------------------
const EXT_TO_GRAMMAR: Record<string, string> = {
  py: 'python',
  pyw: 'python',
  go: 'go',
  java: 'java',
  rs: 'rust',
  cs: 'c_sharp',
  rb: 'ruby',
  php: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  sc: 'scala',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  c: 'c',
  h: 'c',
  lua: 'lua',
}

/** Whether a file extension has a tree-sitter grammar we support. */
export function isTreeSitterSupported(ext: string | undefined): boolean {
  if (!ext) return false
  return ext.toLowerCase().replace(/^\./, '') in EXT_TO_GRAMMAR
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let ParserClass: TSParserCtor | null = null
let parserReady = false
const loadedLangs = new Map<string, TSLanguage>()
// Browser: grammar URLs registered by the app entry
let registeredCoreUrl: string | undefined
const registeredGrammarUrls = new Map<string, string>()

/**
 * Register grammar wasm URLs (browser only). Call from the app entry before
 * any indexing. Pass `core` = URL of `tree-sitter.wasm` and an object mapping
 * grammar name (e.g. "python") to its wasm URL.
 */
export function registerGrammarUrls(
  core: string,
  grammars: Record<string, string>,
): void {
  registeredCoreUrl = core
  for (const [name, url] of Object.entries(grammars)) {
    registeredGrammarUrls.set(name, url)
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null

function nodeResolve(spec: string): string {
  // eslint-disable-next-line no-eval
  const req = (0, eval)('require') as NodeRequire
  return req.resolve(spec)
}

/** Ensure the parser runtime is ready. Idempotent, never throws. */
export async function ensureTreeSitter(): Promise<boolean> {
  if (parserReady) return true
  try {
    // Dynamic import: web-tree-sitter ships CJS with a default export.
    const mod = await import('web-tree-sitter')
    ParserClass = (mod.default ?? mod) as unknown as TSParserCtor

    const locateFile = (name: string) => {
      if (isNode) {
        return nodeResolve(`web-tree-sitter/${name}`)
      }
      if (name === 'tree-sitter.wasm' && registeredCoreUrl) {
        return registeredCoreUrl
      }
      return name
    }

    await ParserClass.init({ locateFile })
    parserReady = true
    return true
  } catch {
    parserReady = false
    return false
  }
}

async function loadGrammar(grammarName: string): Promise<TSLanguage | null> {
  const cached = loadedLangs.get(grammarName)
  if (cached) return cached
  if (!ParserClass) return null
  try {
    let wasmPath: string
    if (isNode) {
      wasmPath = nodeResolve(`tree-sitter-wasms/out/tree-sitter-${grammarName}.wasm`)
    } else {
      const url = registeredGrammarUrls.get(grammarName)
      if (!url) return null
      wasmPath = url
    }
    const lang = await ParserClass.Language.load(wasmPath)
    loadedLangs.set(grammarName, lang)
    return lang
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Whether tree-sitter is ready (init succeeded). */
export function isTreeSitterReady(): boolean {
  return parserReady
}

/**
 * Extract entities + imports from a source string using tree-sitter.
 * Returns null if the grammar can't load or tree-sitter isn't init'd.
 */
export async function extractTreeSitter(
  content: string,
  fileName: string,
  extension: string,
): Promise<AstExtractResult | null> {
  if (!parserReady || !ParserClass) return null
  const ext = extension.toLowerCase().replace(/^\./, '')
  const grammarName = EXT_TO_GRAMMAR[ext]
  if (!grammarName) return null

  const lang = await loadGrammar(grammarName)
  if (!lang) return null

  const parser = new ParserClass()
  parser.setLanguage(lang)
  const tree = parser.parse(content)

  const entities: AstEntity[] = []
  const imports: string[] = []

  const ctx = { parent: undefined as string | undefined }

  function lineOf(node: TSNode): number {
    return node.startPosition.row + 1
  }
  function endLineOf(node: TSNode): number {
    return node.endPosition.row + 1
  }
  function firstLine(node: TSNode): string {
    const t = node.text
    const nl = t.indexOf('\n')
    return (nl === -1 ? t : t.slice(0, nl)).replace(/\s+/g, ' ').trim()
  }
  function nameOf(node: TSNode): string | undefined {
    return node.childForFieldName('name')?.text
  }

  function addEntity(
    name: string,
    type: AstEntity['type'],
    node: TSNode,
    extra?: Partial<Pick<AstEntity, 'parentName' | 'extends' | 'implements' | 'signature'>>,
  ) {
    entities.push({
      name,
      type,
      line: lineOf(node),
      endLine: endLineOf(node),
      signature: firstLine(node),
      ...extra,
    })
  }

  function visitChildren(node: TSNode, parent?: string) {
    for (let i = 0; i < node.namedChildCount; i++) {
      visit(node.namedChild(i), parent)
    }
  }

  // --- language-specific visitors ---

  function visitPython(node: TSNode, parent?: string): void {
    switch (node.type) {
      case 'class_definition': {
        const n = nameOf(node)
        if (!n) break
        const bases: string[] = []
        const argList = node.childForFieldName('superclasses')
        if (argList) {
          for (let i = 0; i < argList.namedChildCount; i++) {
            const a = argList.namedChild(i)
            if (a.type === 'identifier' || a.type === 'attribute') bases.push(a.text)
          }
        }
        addEntity(n, 'Class', node, { extends: bases.length ? bases : undefined })
        const body = node.childForFieldName('body')
        if (body) visitChildren(body, n)
        return
      }
      case 'decorated_definition': {
        // unwrap decorator → class/function
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c.type !== 'decorator') visitPython(c, parent)
        }
        return
      }
      case 'function_definition': {
        const n = nameOf(node)
        if (!n) break
        if (parent) {
          addEntity(n, 'Method', node, { parentName: parent })
        } else {
          addEntity(n, 'Function', node)
        }
        // don't recurse into function bodies to avoid nested functions becoming methods
        return
      }
      case 'import_statement': {
        // import foo, bar
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c.type === 'dotted_name' || c.type === 'aliased_import') {
            imports.push(c.childForFieldName('name')?.text ?? c.text)
          }
        }
        return
      }
      case 'import_from_statement': {
        const mod = node.childForFieldName('module_name')
        if (mod) imports.push(mod.text)
        return
      }
      default:
        break
    }
    visitChildren(node, parent)
  }

  function visitGo(node: TSNode, parent?: string): void {
    switch (node.type) {
      case 'type_declaration': {
        visitChildren(node, parent)
        return
      }
      case 'type_spec': {
        const n = nameOf(node)
        if (!n) break
        // Check child for struct vs interface vs other
        let isStruct = false
        let isIface = false
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c.type === 'struct_type') isStruct = true
          if (c.type === 'interface_type') isIface = true
        }
        if (isStruct) addEntity(n, 'Class', node)
        else if (isIface) addEntity(n, 'Interface', node)
        else addEntity(n, 'Type', node)
        return
      }
      case 'function_declaration': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Function', node)
        return
      }
      case 'method_declaration': {
        const n = nameOf(node)
        if (!n) break
        // receiver type
        const recv = node.childForFieldName('receiver')
        let recvType: string | undefined
        if (recv) {
          // receiver parameter list: func (c Circle) or func (c *Circle)
          for (let i = 0; i < recv.namedChildCount; i++) {
            const p = recv.namedChild(i)
            if (p.type === 'parameter_declaration') {
              const t = p.childForFieldName('type')
              if (t) {
                recvType = t.type === 'pointer_type'
                  ? t.namedChild(0)?.text
                  : t.text
              }
            }
          }
        }
        addEntity(n, 'Method', node, { parentName: recvType })
        return
      }
      case 'import_declaration': {
        visitChildren(node, parent)
        return
      }
      case 'import_spec': {
        const path = node.childForFieldName('path')
        if (path) imports.push(path.text.replace(/"/g, ''))
        return
      }
      default:
        break
    }
    visitChildren(node, parent)
  }

  function visitJava(node: TSNode, parent?: string): void {
    switch (node.type) {
      case 'class_declaration': {
        const n = nameOf(node)
        if (!n) break
        const ext: string[] = []
        const impl: string[] = []
        const sc = node.childForFieldName('superclass')
        if (sc) ext.push(sc.text.replace(/<[^>]+>/g, ''))
        const si = node.childForFieldName('interfaces')
        if (si) {
          for (let i = 0; i < si.namedChildCount; i++) {
            const t = si.namedChild(i)
            impl.push(t.text.replace(/<[^>]+>/g, ''))
          }
        }
        addEntity(n, 'Class', node, {
          extends: ext.length ? ext : undefined,
          implements: impl.length ? impl : undefined,
        })
        const body = node.childForFieldName('body')
        if (body) visitChildren(body, n)
        return
      }
      case 'interface_declaration': {
        const n = nameOf(node)
        if (!n) break
        const ext: string[] = []
        const ei = node.childForFieldName('extends')
        if (ei) {
          for (let i = 0; i < ei.namedChildCount; i++) {
            ext.push(ei.namedChild(i).text.replace(/<[^>]+>/g, ''))
          }
        }
        addEntity(n, 'Interface', node, { extends: ext.length ? ext : undefined })
        const body = node.childForFieldName('body')
        if (body) visitChildren(body, n)
        return
      }
      case 'enum_declaration': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Enum', node)
        return
      }
      case 'method_declaration': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Method', node, { parentName: parent })
        return
      }
      case 'constructor_declaration': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Method', node, { parentName: parent })
        return
      }
      case 'import_declaration': {
        // skip 'import' keyword child, get scoped_identifier text
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c.type === 'scoped_identifier') imports.push(c.text)
        }
        return
      }
      default:
        break
    }
    visitChildren(node, parent)
  }

  function visitRust(node: TSNode, parent?: string): void {
    switch (node.type) {
      case 'struct_item': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Class', node)
        return
      }
      case 'trait_item': {
        const n = nameOf(node)
        if (!n) break
        addEntity(n, 'Interface', node)
        const body = node.childForFieldName('body')
        if (body) visitChildren(body, n)
        return
      }
      case 'enum_item': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Enum', node)
        return
      }
      case 'impl_item': {
        // impl [Trait for] Type { methods }
        const typeNode = node.childForFieldName('type')
        const traitNode = node.childForFieldName('trait')
        const typeName = typeNode?.text
        const body = node.childForFieldName('body')
        if (body && typeName) {
          visitChildren(body, typeName)
        }
        // Record implements relation for ontology to pick up via entities
        if (traitNode && typeName) {
          // We emit a synthetic entity-level hint: a Class entity for the type
          // with implements. ontology will deduplicate by name.
          // Actually, just collect trait name; ontology resolves extends/implements
          // from AstEntity fields on the struct_item. But struct_item has no
          // implements info — it's on the impl block. So we need to capture it.
          // Emit as an additional synthetic Class entry with implements:
          // ontology's extractEntitiesFromAst picks these up.
          entities.push({
            name: typeName,
            type: 'Class',
            line: lineOf(node),
            endLine: endLineOf(node),
            signature: firstLine(node),
            implements: [traitNode.text],
          })
        }
        return
      }
      case 'function_item': {
        const n = nameOf(node)
        if (!n) break
        if (parent) {
          addEntity(n, 'Method', node, { parentName: parent })
        } else {
          addEntity(n, 'Function', node)
        }
        return
      }
      case 'function_signature_item': {
        const n = nameOf(node)
        if (n && parent) addEntity(n, 'Method', node, { parentName: parent })
        return
      }
      case 'use_declaration': {
        // use path::to::thing
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c.type === 'scoped_identifier' || c.type === 'identifier' || c.type === 'use_as_clause' || c.type === 'scoped_use_list') {
            imports.push(c.text)
          }
        }
        return
      }
      default:
        break
    }
    visitChildren(node, parent)
  }

  function visitCSharp(node: TSNode, parent?: string): void {
    switch (node.type) {
      case 'class_declaration':
      case 'struct_declaration': {
        const n = nameOf(node)
        if (!n) break
        const ext: string[] = []
        const baseList = node.childForFieldName('bases')
        if (baseList) {
          for (let i = 0; i < baseList.namedChildCount; i++) {
            ext.push(baseList.namedChild(i).text.replace(/<[^>]+>/g, ''))
          }
        }
        addEntity(n, 'Class', node, { extends: ext.length ? ext : undefined })
        const body = node.childForFieldName('body')
        if (body) visitChildren(body, n)
        return
      }
      case 'interface_declaration': {
        const n = nameOf(node)
        if (!n) break
        addEntity(n, 'Interface', node)
        const body = node.childForFieldName('body')
        if (body) visitChildren(body, n)
        return
      }
      case 'enum_declaration': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Enum', node)
        return
      }
      case 'method_declaration':
      case 'constructor_declaration': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Method', node, { parentName: parent })
        return
      }
      case 'using_directive': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c.type === 'identifier' || c.type === 'qualified_name') {
            imports.push(c.text)
          }
        }
        return
      }
      default:
        break
    }
    visitChildren(node, parent)
  }

  function visitGeneric(node: TSNode, parent?: string): void {
    // Generic fallback for ruby, php, kotlin, swift, scala, etc.
    // Tries common node-type conventions across grammars.
    switch (node.type) {
      case 'class_definition':    // ruby, python
      case 'class_declaration':   // php, kotlin, swift, scala
      case 'class': {             // ruby
        const n = nameOf(node)
        if (!n) break
        addEntity(n, 'Class', node)
        visitChildren(node, n)
        return
      }
      case 'module':              // ruby
      case 'object_declaration':  // kotlin, scala
      {
        const n = nameOf(node)
        if (n) addEntity(n, 'Class', node)
        visitChildren(node, n)
        return
      }
      case 'interface_declaration': {
        const n = nameOf(node)
        if (!n) break
        addEntity(n, 'Interface', node)
        visitChildren(node, n)
        return
      }
      case 'enum_declaration': {
        const n = nameOf(node)
        if (n) addEntity(n, 'Enum', node)
        return
      }
      case 'function_definition':
      case 'function_declaration':
      case 'method_definition':
      case 'method_declaration':
      case 'method':              // ruby
      case 'function_item':       // rust-like
      case 'fun_declaration': {   // kotlin
        const n = nameOf(node)
        if (!n) break
        if (parent) addEntity(n, 'Method', node, { parentName: parent })
        else addEntity(n, 'Function', node)
        return
      }
      default:
        break
    }
    visitChildren(node, parent)
  }

  // ---- dispatch visitor by grammar ----
  function visit(node: TSNode, parent?: string) {
    switch (grammarName) {
      case 'python': return visitPython(node, parent)
      case 'go': return visitGo(node, parent)
      case 'java': return visitJava(node, parent)
      case 'rust': return visitRust(node, parent)
      case 'c_sharp': return visitCSharp(node, parent)
      default: return visitGeneric(node, parent)
    }
  }

  visitChildren(tree.rootNode, ctx.parent)

  return { entities, imports }
}
