# CodeWiki - AI Code Knowledge Base

A cross-platform desktop application that replicates DeepWiki's functionality, with an ontology-based semantic model for precise code understanding and modification.

## Features

### Core Wiki Engine
- **Instant Wiki Generation**: Select a local folder or GitHub repo URL → AI generates comprehensive wiki documentation
- **Mermaid Diagrams**: Auto-generated architecture and data flow diagrams
- **Wiki Navigation**: Sidebar with page tree, inline source references

### Ontology-Based Semantic Model
- **Code Ontology**: RDF-like knowledge graph of code entities (classes, functions, interfaces, modules)
- **Relation Extraction**: Automatically detects imports, extends, implements, calls, contains relationships
- **Impact Analysis**: Query the ontology to find all entities affected by a change
- **Type-Aware Retrieval**: Semantic search enhanced with ontology relationships

### Knowledge Graph Visualization
- **D3-Force Graph**: Interactive visualization of code entity relationships
- **Entity Filtering**: Filter by type (Class, Function, Interface, etc.)
- **Drag & Zoom**: Navigate large codebases visually
- **Color-Coded**: Distinct colors for each entity type

### Semantic Search
- **TF-IDF Vector Store**: Local semantic search without external APIs
- **Ontology-Aware**: Search results enriched with entity relationships
- **Multi-Type**: Search across wiki, code, and entities simultaneously

### RAG-Powered Chat (Ask)
- **Context-Grounded Answers**: Retrieval-Augmented Generation with code ontology context
- **Source References**: Every answer linked to specific file:line references
- **Streaming Responses**: Real-time streaming for OpenAI-compatible providers

### Code Agent
- **Ontology-Constrained Modifications**: Uses knowledge graph for impact analysis before changes
- **Precise Changes**: Exact file paths, line numbers, and diffs
- **Anti-Hallucination**: Verifies all changes against the actual code structure
- **Multi-File Awareness**: Understands cross-file dependencies

### MCP (Model Context Protocol) Server
- **5 MCP Tools**: read_wiki, search_code, get_entity_info, get_dependencies, get_impact_analysis
- **IDE Integration**: Any MCP-compatible IDE or agent can query the code knowledge base
- **Stdio Protocol**: Standard MCP server that works with Claude, Cursor, etc.

### VSCode Extension
- **Sidebar Views**: Wiki pages, code entities, chat panel
- **Commands**: Open Wiki, Semantic Search, Knowledge Graph, Ask, Generate Wiki, Impact Analysis
- **MCP Client**: Communicates with the CodeWiki desktop app

## Tech Stack

- **Desktop**: Electron + React 18 + TypeScript + Vite
- **Styling**: TailwindCSS (dark theme matching DeepWiki)
- **LLM**: OpenAI / Anthropic / DeepSeek / Ollama (local)
- **Ontology**: Custom RDF-like entity-relation model
- **Vector Store**: TF-IDF local vector store
- **Diagrams**: Mermaid.js
- **Graph**: D3-force
- **State**: Zustand
- **MCP**: @modelcontextprotocol/sdk
- **VSCode**: VSCode Extension API

## Quick Install (one-click)

Requires Node.js 18+ and git. Clones, builds, and packages for your platform automatically. See [INSTALL.md](INSTALL.md) for details and prebuilt downloads.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/gaosichun888/codewiki/main/install.ps1 | iex
```

Prebuilt installers (`.AppImage`, `.deb`, Windows `.exe`, macOS `.dmg`) are published on [GitHub Releases](https://github.com/gaosichun888/codewiki/releases).

## Getting Started

```bash
# Install dependencies
npm install

# Development mode
npm run electron:dev

# Build for production
npm run electron:build
```

## Configuration

1. Open the app → click Settings (gear icon)
2. Select your LLM provider (OpenAI, Anthropic, DeepSeek, Ollama)
3. Enter your API key
4. Select model

## MCP Server Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "codewiki": {
      "command": "node",
      "args": ["path/to/codewiki/dist/server/mcp-server.js"],
      "env": { "PROJECT_PATH": "/path/to/your/project" }
    }
  }
}
```

## Project Structure

```
codewiki/
├── electron/           # Electron main process
│   ├── main.ts        # Window management, IPC handlers, file system
│   └── preload.ts     # Context bridge API
├── src/               # React renderer
│   ├── components/    # UI components
│   │   ├── WelcomeScreen.tsx    # Project selection
│   │   ├── Layout.tsx           # Main app layout
│   │   ├── TopBar.tsx           # Navigation & controls
│   │   ├── Sidebar.tsx          # Wiki pages & entities tree
│   │   ├── WikiViewer.tsx       # Markdown wiki renderer
│   │   ├── MermaidDiagram.tsx   # Mermaid diagram renderer
│   │   ├── KnowledgeGraph.tsx   # D3-force graph visualization
│   │   ├── SearchPanel.tsx      # Semantic search UI
│   │   ├── ChatPanel.tsx        # RAG chat interface
│   │   ├── CodeAgentPanel.tsx   # Code modification agent
│   │   └── SettingsModal.tsx    # LLM configuration
│   ├── services/      # Core logic
│   │   ├── ontology.ts          # Ontology model builder
│   │   ├── indexer.ts           # Code file indexer
│   │   ├── vector-store.ts      # TF-IDF vector store
│   │   ├── llm.ts               # Multi-provider LLM client
│   │   ├── wiki-generator.ts    # AI wiki generation
│   │   ├── code-agent.ts        # Ontology-constrained code agent
│   │   └── mcp-server.ts        # MCP tool implementations
│   ├── store/         # Zustand state management
│   └── types/         # TypeScript type definitions
├── server/            # Standalone MCP server
├── vscode-extension/  # VSCode extension
└── package.json
```

## License

MIT
