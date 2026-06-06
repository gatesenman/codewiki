import { useState, useCallback } from 'react'
import { Search, FileText, Code, Box, Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import { services } from '../services/service-registry'
import type { SearchResult, OntologyEntityType } from '../types'

export function SearchPanel() {
  const { currentProject, searchQuery, setSearchQuery, searchResults, setSearchResults } = useAppStore()
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchType, setSearchType] = useState<'all' | 'code' | 'entity' | 'wiki'>('all')

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !currentProject) return

    setSearching(true)
    setHasSearched(true)
    const results: SearchResult[] = []

    // Search in wiki pages
    if (searchType === 'all' || searchType === 'wiki') {
      for (const page of currentProject.wikiPages) {
        const content = page.content.toLowerCase()
        const query = searchQuery.toLowerCase()
        if (content.includes(query) || page.title.toLowerCase().includes(query)) {
          const idx = content.indexOf(query)
          results.push({
            id: page.id,
            type: 'wiki',
            title: page.title,
            content: page.content.substring(Math.max(0, idx - 100), idx + 200),
            score: page.title.toLowerCase().includes(query) ? 1 : 0.7,
          })
        }
      }
    }

    // Search in ontology entities
    if (searchType === 'all' || searchType === 'entity') {
      const query = searchQuery.toLowerCase()
      for (const entity of currentProject.ontologyGraph.entities) {
        if (entity.name.toLowerCase().includes(query)) {
          results.push({
            id: entity.id,
            type: 'entity',
            title: entity.name,
            content: `${entity.type} at ${entity.filePath}:${entity.line}${entity.signature ? '\n' + entity.signature : ''}`,
            score: entity.name.toLowerCase() === query ? 1 : 0.8,
            filePath: entity.filePath,
            line: entity.line,
            entityType: entity.type,
          })
        }
      }
    }

    // Vector search in code (hybrid when embeddings are available)
    if (searchType === 'all' || searchType === 'code') {
      const vectorResults = await services.vectorStore.searchHybrid(searchQuery, 10)
      for (const r of vectorResults) {
        results.push({
          id: r.id,
          type: 'code',
          title: r.metadata.filePath || r.id,
          content: r.content,
          score: r.score,
          filePath: r.metadata.filePath,
        })
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score)
    setSearchResults(results)
    setSearching(false)
  }, [searchQuery, currentProject, searchType, setSearchResults])

  return (
    <div className="h-full flex flex-col">
      {/* Search input */}
      <div className="px-6 py-4 border-b border-wiki-border bg-wiki-sidebar">
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-wiki-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search code, wiki, entities..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-wiki-bg border border-wiki-border text-sm text-wiki-text placeholder:text-wiki-muted/50 focus:outline-none focus:border-wiki-accent"
              autoFocus
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="px-4 py-2 rounded-lg bg-wiki-accent text-white text-sm font-medium hover:bg-wiki-accent/80 disabled:opacity-50 transition-colors"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : 'Search'}
          </button>
        </div>

        {/* Search type filter */}
        <div className="flex gap-2">
          {[
            { id: 'all' as const, label: 'All' },
            { id: 'code' as const, label: 'Code' },
            { id: 'entity' as const, label: 'Entities' },
            { id: 'wiki' as const, label: 'Wiki' },
          ].map(type => (
            <button
              key={type.id}
              onClick={() => setSearchType(type.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                searchType === type.id
                  ? 'bg-wiki-accent/15 text-wiki-accent'
                  : 'text-wiki-muted hover:text-wiki-text'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {searchResults.length === 0 && searchQuery && hasSearched && !searching ? (
          <div className="text-center text-wiki-muted py-12">
            <Search size={32} className="mx-auto mb-3 text-wiki-muted/30" />
            <p className="text-sm">No results found for "{searchQuery}"</p>
          </div>
        ) : (
          <div className="space-y-3">
            {searchResults.map((result) => (
              <SearchResultCard key={result.id} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const { setSelectedEntityId } = useAppStore()

  const typeIcons = {
    wiki: <FileText size={14} className="text-wiki-accent" />,
    code: <Code size={14} className="text-wiki-green" />,
    entity: <Box size={14} className="text-wiki-purple" />,
  }

  const typeLabels = {
    wiki: 'Wiki',
    code: 'Code',
    entity: 'Entity',
  }

  const handleClick = () => {
    if (result.type === 'entity') {
      setSelectedEntityId(result.id)
    }
  }

  return (
    <div
      onClick={handleClick}
      className="p-4 rounded-lg border border-wiki-border bg-wiki-card hover:border-wiki-accent/30 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-2 mb-2">
        {typeIcons[result.type]}
        <span className="text-[10px] uppercase font-semibold text-wiki-muted tracking-wider">
          {typeLabels[result.type]}
        </span>
        {result.entityType && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-wiki-purple/10 text-wiki-purple">
            {result.entityType}
          </span>
        )}
        <span className="ml-auto text-[10px] text-wiki-muted/50">
          {(result.score * 100).toFixed(0)}% match
        </span>
      </div>
      <h4 className="text-sm font-medium text-wiki-text mb-1">{result.title}</h4>
      {result.filePath && (
        <div className="text-[11px] text-wiki-muted mb-1 font-mono">
          {result.filePath}{result.line ? `:${result.line}` : ''}
        </div>
      )}
      <p className="text-xs text-wiki-muted/80 line-clamp-3 whitespace-pre-wrap">
        {result.content}
      </p>
    </div>
  )
}
