/**
 * AST-based extraction for TypeScript / JavaScript.
 *
 * Uses the TypeScript compiler's parser (syntax tree only — no type checker,
 * no tsconfig, no Program) to extract code entities and structural relations
 * far more accurately than regex. Handles generics, decorators, overloads,
 * nested scopes, arrow-function components, and JSX without the false
 * positives/negatives the regex patterns produce.
 *
 * This module is intentionally pure and free of any DOM/Electron/Node-fs
 * dependencies so it can be consumed from the renderer, the standalone MCP
 * server, and the CLI alike. Only `typescript` is required at runtime.
 */

import ts from 'typescript'
import type { OntologyEntityType } from '../types'

export interface AstEntity {
  name: string
  type: OntologyEntityType
  /** 1-based start line */
  line: number
  /** 1-based end line */
  endLine: number
  signature?: string
  /** Enclosing class/interface name for methods, undefined for top-level. */
  parentName?: string
  /** Superclass / extended interface names. */
  extends?: string[]
  /** Implemented interface names (classes only). */
  implements?: string[]
}

export interface AstExtractResult {
  entities: AstEntity[]
  /** Raw module specifiers from import/export-from/require/dynamic import. */
  imports: string[]
}

const TS_EXTENSIONS = new Set(['ts', 'tsx', 'mts', 'cts'])
const JS_EXTENSIONS = new Set(['js', 'jsx', 'mjs', 'cjs'])

/** Whether a file extension should be parsed with the TS/JS AST extractor. */
export function isAstSupported(extension: string | undefined): boolean {
  if (!extension) return false
  const ext = extension.toLowerCase().replace(/^\./, '')
  return TS_EXTENSIONS.has(ext) || JS_EXTENSIONS.has(ext)
}

function scriptKindFor(ext: string): ts.ScriptKind {
  switch (ext) {
    case 'tsx': return ts.ScriptKind.TSX
    case 'jsx': return ts.ScriptKind.JSX
    case 'js':
    case 'mjs':
    case 'cjs': return ts.ScriptKind.JS
    default: return ts.ScriptKind.TS
  }
}

function firstLineOf(text: string): string {
  const nl = text.indexOf('\n')
  return (nl === -1 ? text : text.slice(0, nl)).replace(/\s+/g, ' ').trim()
}

function nameText(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function heritageNames(
  clauses: ts.NodeArray<ts.HeritageClause> | undefined,
  keyword: ts.SyntaxKind,
): string[] {
  const out: string[] = []
  if (!clauses) return out
  for (const clause of clauses) {
    if (clause.token !== keyword) continue
    for (const t of clause.types) {
      const expr = t.expression
      if (ts.isIdentifier(expr)) out.push(expr.text)
      else if (ts.isPropertyAccessExpression(expr)) out.push(expr.name.text)
    }
  }
  return out
}

function isLikelyComponent(name: string, ext: string): boolean {
  return /^[A-Z]/.test(name) && (ext === 'tsx' || ext === 'jsx')
}

function isHook(name: string): boolean {
  return /^use[A-Z]/.test(name)
}

export interface AstExtractOptions {
  /** Include arrow functions / React components declared as variables. */
  extractArrowFunctions?: boolean
  /** Keep leading decorator(s) in entity signatures. */
  extractDecorators?: boolean
}

/** Strip leading `@Decorator(...)` prefixes from a one-line signature. */
function stripDecorators(signature: string): string {
  let s = signature
  // Remove repeated leading decorators (with or without call args).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = s.replace(/^@\w+(?:\([^)]*\))?\s+/, '')
    if (next === s) break
    s = next
  }
  return s
}

/**
 * Extract entities + import specifiers from a TS/JS source string.
 * `extension` selects the parser dialect (tsx/jsx enable JSX parsing).
 */
export function extractTsAst(
  content: string,
  fileName: string,
  extension: string,
  options: AstExtractOptions = {},
): AstExtractResult {
  const extractArrowFunctions = options.extractArrowFunctions !== false
  const extractDecorators = options.extractDecorators !== false
  const ext = (extension || 'ts').toLowerCase().replace(/^\./, '')
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(ext),
  )

  const entities: AstEntity[] = []
  const imports: string[] = []

  const lineOf = (pos: number) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1
  const rangeOf = (node: ts.Node): { line: number; endLine: number } => ({
    line: lineOf(node.getStart(sourceFile)),
    endLine: lineOf(node.getEnd()),
  })
  const sig = (node: ts.Node): string => {
    const s = firstLineOf(node.getText(sourceFile))
    return extractDecorators ? s : stripDecorators(s)
  }

  const addModuleSpecifier = (spec: ts.Expression | undefined) => {
    if (spec && ts.isStringLiteralLike(spec)) imports.push(spec.text)
  }

  const visit = (node: ts.Node, enclosingType?: string) => {
    // ---- imports / re-exports ----
    if (ts.isImportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      addModuleSpecifier(node.moduleSpecifier)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0
    ) {
      addModuleSpecifier(node.arguments[0])
    }

    // ---- classes ----
    if (ts.isClassDeclaration(node) && node.name) {
      const { line, endLine } = rangeOf(node)
      const className = node.name.text
      entities.push({
        name: className,
        type: 'Class',
        line,
        endLine,
        signature: sig(node),
        extends: heritageNames(node.heritageClauses, ts.SyntaxKind.ExtendsKeyword),
        implements: heritageNames(node.heritageClauses, ts.SyntaxKind.ImplementsKeyword),
      })
      for (const member of node.members) {
        if (ts.isConstructorDeclaration(member)) {
          const r = rangeOf(member)
          entities.push({
            name: 'constructor',
            type: 'Constructor',
            line: r.line,
            endLine: r.endLine,
            signature: sig(member),
            parentName: className,
          })
        } else if (
          (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) &&
          member.name
        ) {
          const mName = nameText(member.name)
          if (!mName) continue
          const r = rangeOf(member)
          entities.push({
            name: mName,
            type: 'Method',
            line: r.line,
            endLine: r.endLine,
            signature: sig(member),
            parentName: className,
          })
        } else if (ts.isPropertyDeclaration(member) && member.name) {
          const pName = nameText(member.name)
          if (!pName) continue
          const r = rangeOf(member)
          const isConst = member.modifiers?.some(m =>
            m.kind === ts.SyntaxKind.ReadonlyKeyword || m.kind === ts.SyntaxKind.StaticKeyword,
          )
          entities.push({
            name: pName,
            type: isConst ? 'Constant' : 'Property',
            line: r.line,
            endLine: r.endLine,
            signature: sig(member),
            parentName: className,
          })
        }
      }
      node.members.forEach(m => visit(m, 'Class'))
      return
    }

    // ---- interfaces ----
    if (ts.isInterfaceDeclaration(node)) {
      const { line, endLine } = rangeOf(node)
      entities.push({
        name: node.name.text,
        type: 'Interface',
        line,
        endLine,
        signature: sig(node),
        extends: heritageNames(node.heritageClauses, ts.SyntaxKind.ExtendsKeyword),
      })
      ts.forEachChild(node, c => visit(c, 'Interface'))
      return
    }

    // ---- top-level function declarations ----
    if (ts.isFunctionDeclaration(node) && node.name) {
      const { line, endLine } = rangeOf(node)
      const fnName = node.name.text
      const fnType = isLikelyComponent(fnName, ext) ? 'Component'
        : isHook(fnName) ? 'Hook'
        : 'Function'
      entities.push({
        name: fnName,
        type: fnType,
        line,
        endLine,
        signature: sig(node),
      })
      ts.forEachChild(node, c => visit(c, enclosingType))
      return
    }

    // ---- const/let arrow functions, function expressions, React.memo/forwardRef ----
    if (ts.isVariableStatement(node)) {
      const isConstDecl = (node.declarationList.flags & ts.NodeFlags.Const) !== 0
      for (const decl of node.declarationList.declarations) {
        const varName = nameText(decl.name)
        if (!varName || !decl.initializer) continue
        const init = decl.initializer
        const isFnLike =
          ts.isArrowFunction(init) ||
          ts.isFunctionExpression(init) ||
          isReactFactory(init)
        if (isFnLike && extractArrowFunctions) {
          const r = rangeOf(decl)
          const fnType = isLikelyComponent(varName, ext) ? 'Component'
            : isHook(varName) ? 'Hook'
            : 'Function'
          entities.push({
            name: varName,
            type: fnType,
            line: r.line,
            endLine: r.endLine,
            signature: sig(node),
          })
        } else if (!isFnLike && isConstDecl && /^[A-Z_][A-Z0-9_]*$/.test(varName)) {
          const r = rangeOf(decl)
          entities.push({
            name: varName,
            type: 'Constant',
            line: r.line,
            endLine: r.endLine,
            signature: sig(node),
          })
        }
      }
    }

    // ---- type aliases / enums / namespaces ----
    if (ts.isTypeAliasDeclaration(node)) {
      const { line, endLine } = rangeOf(node)
      entities.push({ name: node.name.text, type: 'TypeAlias', line, endLine, signature: sig(node) })
    } else if (ts.isEnumDeclaration(node)) {
      const { line, endLine } = rangeOf(node)
      entities.push({ name: node.name.text, type: 'Enum', line, endLine, signature: sig(node) })
    } else if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const { line, endLine } = rangeOf(node)
      entities.push({ name: node.name.text, type: 'Namespace', line, endLine, signature: sig(node) })
    }

    ts.forEachChild(node, c => visit(c, enclosingType))
  }

  ts.forEachChild(sourceFile, n => visit(n))

  return { entities, imports }
}

function isReactFactory(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node)) return false
  const expr = node.expression
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text === 'React' &&
      ['memo', 'forwardRef', 'lazy'].includes(expr.name.text)
  }
  if (ts.isIdentifier(expr)) {
    return ['memo', 'forwardRef', 'lazy'].includes(expr.text)
  }
  return false
}
