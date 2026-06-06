/**
 * Browser-only registration of tree-sitter wasm asset URLs.
 *
 * Vite turns each `?url` import into an on-demand asset URL, so grammars are
 * fetched lazily (only when a file of that language is indexed) rather than
 * bundled into the main JS chunk. Import this module for its side effect from
 * the renderer entry (see {@link file://./../main.tsx}) before any indexing.
 *
 * In Node (CLI/MCP) the extractor resolves wasm paths via `require.resolve`
 * instead, so this module is never imported there.
 */
import coreUrl from 'web-tree-sitter/tree-sitter.wasm?url'
import pythonUrl from 'tree-sitter-wasms/out/tree-sitter-python.wasm?url'
import goUrl from 'tree-sitter-wasms/out/tree-sitter-go.wasm?url'
import javaUrl from 'tree-sitter-wasms/out/tree-sitter-java.wasm?url'
import rustUrl from 'tree-sitter-wasms/out/tree-sitter-rust.wasm?url'
import cSharpUrl from 'tree-sitter-wasms/out/tree-sitter-c_sharp.wasm?url'
import rubyUrl from 'tree-sitter-wasms/out/tree-sitter-ruby.wasm?url'
import phpUrl from 'tree-sitter-wasms/out/tree-sitter-php.wasm?url'
import kotlinUrl from 'tree-sitter-wasms/out/tree-sitter-kotlin.wasm?url'
import swiftUrl from 'tree-sitter-wasms/out/tree-sitter-swift.wasm?url'
import scalaUrl from 'tree-sitter-wasms/out/tree-sitter-scala.wasm?url'
import cppUrl from 'tree-sitter-wasms/out/tree-sitter-cpp.wasm?url'
import cUrl from 'tree-sitter-wasms/out/tree-sitter-c.wasm?url'
import luaUrl from 'tree-sitter-wasms/out/tree-sitter-lua.wasm?url'

import { registerGrammarUrls } from './treesitter-extractor'

registerGrammarUrls(coreUrl, {
  python: pythonUrl,
  go: goUrl,
  java: javaUrl,
  rust: rustUrl,
  c_sharp: cSharpUrl,
  ruby: rubyUrl,
  php: phpUrl,
  kotlin: kotlinUrl,
  swift: swiftUrl,
  scala: scalaUrl,
  cpp: cppUrl,
  c: cUrl,
  lua: luaUrl,
})
