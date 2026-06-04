# CodeWiki Rules for Claude Code

When working in this codebase, use the CodeWiki MCP server tools for code intelligence instead of grep/find/read exploration loops.

## Tool Usage Priority

1. **Before ANY code modification**: Call `get_edit_context` with the entity name to get source, callers, callees, tests, and blast radius
2. **To understand code**: Call `get_context` with a natural language query — returns matched entities with source, callers, callees, and relations in one call
3. **To find who calls a function**: Call `find_callers` — much faster than grep
4. **To find what a function calls**: Call `find_callees`
5. **To trace a call path**: Call `trace_path` with `from` and `to` entity names
6. **To assess change risk**: Call `blast_radius` — shows all upstream dependents
7. **To explore multiple symbols**: Call `explore_symbols` with comma-separated names — returns source grouped by file plus relationships
8. **To understand a file**: Call `file_context` — returns all defined symbols, imports, and exports
9. **To check complexity**: Call `analyze_complexity` — cyclomatic complexity and coupling metrics

## Workflow

```
1. get_context "what you want to understand" (intent: explain|modify|debug|test)
2. get_edit_context <EntityName>  (before editing)
3. blast_radius <EntityName>     (assess risk)
4. ... make your changes ...
5. verify_modification <file>    (after editing)
```

## Do NOT

- Do NOT use grep/find to explore code when a CodeWiki tool can answer the question
- Do NOT modify code without first calling `get_edit_context` or `blast_radius`
- Do NOT skip `verify_modification` after making changes
