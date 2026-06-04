# CodeWiki Rules for Codex / OpenAI Codex CLI

Use CodeWiki MCP tools for structured code understanding instead of file-reading loops.

## Primary Workflow

```
get_context <query>           # Understand the area
get_edit_context <entity>     # Get full context before editing
blast_radius <entity>         # Assess change risk
find_callers <entity>         # Who uses this?
find_callees <entity>         # What does this depend on?
trace_path <from> <to>        # How does A reach B?
verify_modification <file>    # Verify after editing
```

## Rules

1. Call `get_edit_context` before modifying any entity
2. Call `blast_radius` for any entity with more than 3 callers
3. Call `verify_modification` after every file edit
4. Use `explore_symbols` to get source for multiple related entities in one call
5. Prefer `get_context` over `search_code` when you know the entity name
