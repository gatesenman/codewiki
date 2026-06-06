# CodeWiki for VS Code

Ontology-based code analysis for precise, hallucination-resistant AI modifications — right inside your editor. This extension is a thin front-end over the [CodeWiki](https://github.com/gaosichun888/codewiki) CLI: it indexes your project into a typed ontology graph and exposes search, impact analysis, pre-modification safety checks, and wiki generation as VS Code commands.

## Features

- **Index Project** — build the ontology graph for the current workspace.
- **Semantic Search** — find code by meaning, jump straight to the file/line.
- **Knowledge Graph** — visualize how entities relate.
- **Ask about Code** — RAG answers grounded in your real code structure.
- **Analyze Impact / Blast Radius** — see what a change touches before you make it.
- **Pre-check Modification** — safety analysis for the symbol under the cursor.
- **Show Relations** — callers / callees / dependencies for any entity.
- **Generate & Export Wiki** — structured docs from the ontology.
- **CodeLens** — inline CodeWiki actions above classes and functions.

## Requirements

The extension shells out to the CodeWiki CLI. Configure how it is launched via
`codewiki.cliPath` (default `npx tsx`). Point it at a globally installed
`codewiki` binary, `ts-node`, or `tsx` as you prefer.

## Extension Settings

| Setting | Default | Description |
| --- | --- | --- |
| `codewiki.llmProvider` | `openai` | LLM provider (openai / anthropic / deepseek / ollama). |
| `codewiki.apiKey` | `""` | API key for the selected provider. |
| `codewiki.model` | `gpt-4o` | Model used for wiki generation and analysis. |
| `codewiki.cliPath` | `npx tsx` | Command prefix used to run the CodeWiki CLI. |
| `codewiki.autoIndex` | `true` | Auto-index the workspace on activation. |
| `codewiki.codeLens` | `true` | Show CodeWiki CodeLens above classes/functions. |

## Building / Installing locally

```bash
cd vscode-extension
npm install
npm run package      # produces codewiki-vscode-<version>.vsix
code --install-extension codewiki-vscode-<version>.vsix
```

## License

MIT © gaosichun888
