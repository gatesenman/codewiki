# CodeWiki Rules for Cursor

Use CodeWiki MCP tools for code intelligence. These tools query a pre-indexed knowledge graph — faster and more accurate than file scanning.

## Key Tools

| Tool | Use When |
|------|----------|
| `get_context` | Understanding any part of the codebase (primary tool) |
| `get_edit_context` | Before editing any entity — returns source + callers + callees + tests |
| `find_callers` | Need to know who calls a function |
| `find_callees` | Need to know what a function calls |
| `blast_radius` | Assessing the risk of a change |
| `trace_path` | Understanding how entity A reaches entity B |
| `explore_symbols` | Getting source for multiple symbols at once |
| `search_code` | Semantic search across the codebase |
| `pre_check` | Comprehensive pre-modification analysis |
| `verify_modification` | Post-modification verification |

## Before Editing Code

Always run `get_edit_context <entity>` first. It returns:
- Current source code
- All callers (with their source)
- All callees
- Related tests
- Forward impact count
- Blast radius

This prevents modifying code without understanding its usage.
