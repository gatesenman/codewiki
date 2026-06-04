# CodeWiki Competitive Analysis & Gap Report

## Competitors Researched

### 1. colbymchenry/codegraph (38K+ stars)
- Pre-indexed code knowledge graph for Claude Code, Codex, Cursor, etc.
- 10 MCP tools: search, context, trace, callers, callees, impact, node, explore, files, status
- 20+ languages via tree-sitter, SQLite + FTS5
- ~16% cheaper, ~58% fewer tool calls vs raw file scanning
- Agent-specific instruction profiles (Claude, Cursor, Codex, etc.)
- Framework-aware routes (14 web frameworks)
- Native OS file watcher (FSEvents/inotify/ReadDirectoryChangesW)

### 2. Understand Anything (47K+ stars)
- Multi-agent pipeline (5 specialized agents)
- LLM-generated plain-English summaries per node
- Guided tours / onboarding walkthroughs
- Business domain mapping (code -> real flows)
- Community clustering / hierarchical drill-down
- Dependency path finder (shortest path A->B)
- 26+ file types (Dockerfiles, Terraform, SQL, Markdown)
- React Flow interactive graph

### 3. Cirilcetra/codegraph
- Kuzu graph database with vector embeddings
- blast_radius (reverse-BFS upstream dependents)
- nl_query (natural language -> Cypher -> validated execution)
- Component tree (React RENDERS descendants)
- 10 typed MCP tools

### 4. RepoGraph (Academic - SWE-bench SOTA)
- Line-level graph (each node = line of code)
- Ego-graph retrieval around central node
- Cross-file definition/reference edges

### 5. aider (Repository map)
- Tree-sitter based repo map with graph ranking
- Token budget optimization
- PageRank for relevance scoring

### 6. polyglot-indexer-mcp
- Tree-sitter + SCIP dual layer
- Compiler-accurate cross-file analysis
- find_references, find_implementations, get_import_graph

### 7. GitNexus (41K+ stars) — NEW
- Client-side knowledge graph (KuzuDB embedded graph database)
- 12-phase ingestion pipeline with confidence scoring (0.0-1.0) on all edges
- **Leiden community detection** — clusters related symbols into functional areas
- **Execution flow / process detection** — traces entry points through full call chains
- 7 MCP tools: list_repos, query, context, impact, detect_changes, rename, cypher
- 7 MCP resources + 2 MCP prompts
- **detect_changes** — git-diff impact mapping (changed lines → affected processes)
- **rename** — multi-file coordinated rename with graph + text search
- **Raw Cypher queries** for power users
- Hybrid search: BM25 + vector + Reciprocal Rank Fusion (RRF)

### 8. codesight-mcp (34 MCP tools)
- **66 languages** via tree-sitter with byte-offset O(1) symbol retrieval
- PageRank on call graph (`get_key_symbols`)
- **Dead code detection** (`get_dead_code`)
- **Mermaid diagram generation** from code graph
- AI-generated summaries (Anthropic API)
- Hybrid keyword + vector semantic search
- 2,495 tests, security-hardened (6-step path validation)
- MCP ToolAnnotations (readOnlyHint, destructiveHint, etc.)

### 9. code-graph-mcp (sdsrss)
- **HTTP route tracing** — `GET /api/users` → handler → service → DB in one query
- Supports Express, Flask/FastAPI, Go net/http, ASP.NET, Rails, Laravel
- **Dead code detection** with Orphan/Exported-Unused classification
- Recursive CTE queries for call graph traversal with cycle detection
- SQLite-vec for vector embeddings
- Merkle tree change detection for incremental indexing
- Token-aware context compression (L0-L3 levels)
- Self-healing SQLite corruption recovery

### 10. central-code-knowledge-graph
- Multi-repo Neo4j graph database
- 26 languages via tree-sitter
- Incremental ingest + webhooks for live updates
- Cursor / VS Code / Claude Code MCP integration

---

## Gap Analysis: CodeWiki vs Competitors

### Previous Gaps (RESOLVED in Iterations 1 & 2)

| Feature | CodeGraph | UA | Cirilcetra | CodeWiki | Status |
|---------|-----------|-----|-----------|----------|--------|
| **find_callers** | Y | - | Y | **DONE** | CLI + MCP |
| **find_callees** | Y | - | Y | **DONE** | CLI + MCP |
| **call_trace** (A->B path) | Y | - | - | **DONE** | CLI + MCP |
| **blast_radius** (reverse BFS) | Y | - | Y | **DONE** | CLI + MCP |
| **smart_context** (one-call) | Y | - | - | **DONE** | CLI + MCP |
| **get_edit_context** | Y | - | - | **DONE** | CLI + MCP |
| **explore** (multi-symbol source) | Y | - | - | **DONE** | CLI + MCP |
| **dependency_path** (shortest) | - | Y | - | **DONE** | CLI + MCP |
| **file_context** (imports/exports) | - | - | Y | **DONE** | CLI + MCP |
| **agent_profiles** (.rules) | Y | - | - | **DONE** | claude-code/cursor/codex |
| **complexity** analysis | Y | - | - | **DONE** | CLI + MCP |

### NEW Gaps (Found in Iteration 3 Research — GitNexus, codesight-mcp, code-graph-mcp)

| Feature | GitNexus | codesight | code-graph | CodeWiki | Priority |
|---------|----------|-----------|------------|----------|----------|
| **LSIF/SCIP** (compiler-accurate indexing) | - | - | - | **NO** | P0 |
| **Dead code detection** | - | Y | Y | **NO** | P0 |
| **find_references** (all usages of a symbol) | - | Y | Y | **NO** | P0 |
| **Confidence scoring** (0-1 on relations) | Y | - | - | **NO** | P1 |
| **HTTP route tracing** | - | - | Y | **NO** | P1 |
| **PageRank** (key symbol identification) | - | Y | - | **NO** | P1 |
| **Execution flow detection** | Y | - | - | **NO** | P2 |
| **Community clustering** (Leiden) | Y | - | - | **NO** | P2 |
| **detect_changes** (git-diff mapping) | Y | - | - | **NO** | P2 |
| **rename** (multi-file coordinated) | Y | - | - | **NO** | P2 |

### What CodeWiki Already Has

| Feature | Status | Tools |
|---------|--------|-------|
| Ontology model (entity/relation) | Full | - |
| Impact analysis (BFS forward) | Full | CLI + MCP |
| Callers / Callees / Trace | Full | CLI + MCP |
| Blast Radius | Full | CLI + MCP |
| Smart Context / Edit Context | Full | CLI + MCP |
| Pre-check + Verify workflow | Full | CLI + MCP |
| Explore + Dependency Path | Full | CLI + MCP |
| File Context | Full | CLI + MCP |
| Complexity analysis | Full | CLI + MCP |
| Agent profiles | Full | claude-code/cursor/codex |
| Batch operations | Full | CLI |
| Wiki export (MD/HTML/JSON) | Full | CLI |
| File watcher | Full | CLI |
| MCP server (20 tools) | Full | - |
| VSCode extension | Full | - |
| i18n (en/zh) | Full | - |
| Settings UI (6 tabs, 60+ items) | Full | - |
| Knowledge graph visualization | Full | - |
| Accuracy test suite (30 tests) | Full | - |
| Dark/Light/System themes | Full | - |

---

## Implementation Plan

### Iteration 3: LSIF/SCIP + New Competitor Features

#### P0 — Accuracy & Coverage
1. **LSIF/SCIP support** — parse SCIP indexes for compiler-accurate definitions/references
2. **Dead code detection** — find unreferenced symbols (orphans + exported-unused)
3. **find_references** — all usage sites of a symbol across the codebase

#### P1 — Competitive Parity
4. **Confidence scoring** — 0-1 score on relation edges
5. **HTTP route tracing** — route → handler → service chain (Express/Flask)
6. **PageRank** — identify structurally important symbols
