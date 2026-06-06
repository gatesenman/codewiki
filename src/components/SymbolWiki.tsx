/**
 * SymbolWiki — DeepWiki-style entity detail page.
 *
 * Shows a detailed wiki page for a single code entity (symbol) with:
 *   - Definition (type, signature, file:line)
 *   - Example Usages (callers with descriptions)
 *   - Notes (coupling warnings, patterns)
 *   - See Also (related entities)
 *   - Follow-up Questions
 */

import { useState, useMemo } from 'react'
import {
  ArrowLeft, FileText, AlertTriangle, Info,
  ChevronDown, ChevronRight, ExternalLink, Search,
  HelpCircle, Link2, BookOpen, Code,
} from 'lucide-react'
import { useAppStore } from '../store'
import { generateSymbolWiki, type SymbolWikiPage } from '../services/symbol-wiki'
import { t } from '../services/i18n'
import type { OntologyEntity, OntologyEntityType } from '../types'

const TYPE_COLORS: Record<OntologyEntityType, string> = {
  Package: '#d29922',
  Module: '#d29922',
  File: '#8b949e',
  Class: '#58a6ff',
  Interface: '#bc8cff',
  Function: '#3fb950',
  Method: '#3fb950',
  Variable: '#8b949e',
  Type: '#f778ba',
  Enum: '#f778ba',
  Component: '#58a6ff',
  Namespace: '#d29922',
  Struct: '#58a6ff',
  Trait: '#bc8cff',
  Property: '#79c0ff',
  Constant: '#ffa657',
  Constructor: '#d2a8ff',
  Decorator: '#ffa657',
  Hook: '#3fb950',
  Event: '#f0883e',
  TypeAlias: '#f778ba',
}

interface SymbolWikiProps {
  entityId: string
  onBack: () => void
  onNavigate: (entityId: string) => void
}

export function SymbolWiki({ entityId, onBack, onNavigate }: SymbolWikiProps) {
  const graph = useAppStore(s => s.currentProject?.ontologyGraph)
  useAppStore(s => s.locale)

  const page = useMemo<SymbolWikiPage | null>(() => {
    if (!graph) return null
    return generateSymbolWiki(graph, entityId)
  }, [graph, entityId])

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['definition', 'usages', 'notes', 'seealso', 'questions']),
  )

  if (!page) {
    return (
      <div className="flex-1 flex items-center justify-center text-wiki-muted">
        {t('symbolWikiNotFound')}
      </div>
    )
  }

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const { entity, definition, usages, notes, seeAlso, followUpQuestions, metadata } = page

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="p-1.5 rounded-md hover:bg-wiki-card text-wiki-muted hover:text-wiki-text transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm text-wiki-muted">Symbol Wiki</span>
        </div>

        <h1 className="text-2xl font-bold text-wiki-text mb-1 flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: TYPE_COLORS[entity.type] }}
          />
          {entity.name}
          <span className="text-sm font-normal text-wiki-muted">({entity.type.toLowerCase()})</span>
        </h1>

        {/* Metadata pills */}
        <div className="flex flex-wrap gap-2 mt-3 mb-6">
          <MetaPill label={t('symbolWikiCallers')} value={metadata.callerCount} />
          <MetaPill label={t('symbolWikiCallees')} value={metadata.calleeCount} />
          <MetaPill label={t('symbolWikiRelations')} value={metadata.totalRelations} />
          <MetaPill
            label={t('symbolWikiCoupling')}
            value={`${Math.round(metadata.couplingScore * 100)}%`}
            warn={metadata.couplingScore > 0.5}
          />
        </div>

        {/* Definition */}
        <CollapsibleSection
          title={t('symbolWikiDefinition')}
          icon={<Code size={16} />}
          expanded={expandedSections.has('definition')}
          onToggle={() => toggleSection('definition')}
        >
          <div className="space-y-3">
            {definition.signature && (
              <pre className="bg-[#161b22] border border-wiki-border rounded-md p-3 text-sm overflow-x-auto font-mono">
                <span className="text-wiki-muted text-xs">
                  {definition.filePath}:{definition.line}
                </span>
                {'\n'}
                <code className="text-wiki-text">{definition.signature}</code>
              </pre>
            )}

            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <span className="font-medium text-wiki-muted min-w-[60px]">Type:</span>
                <span style={{ color: TYPE_COLORS[definition.type] }}>{definition.type}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-medium text-wiki-muted min-w-[60px]">File:</span>
                <span className="text-wiki-link flex items-center gap-1">
                  <FileText size={12} />
                  {definition.filePath}:{definition.line}–{definition.endLine}
                </span>
              </li>
              {definition.context && (
                <li className="flex items-start gap-2">
                  <span className="font-medium text-wiki-muted min-w-[60px]">Context:</span>
                  <span className="text-wiki-text">{definition.context}</span>
                </li>
              )}
              {definition.description && (
                <li className="flex items-start gap-2">
                  <span className="font-medium text-wiki-muted min-w-[60px]">Info:</span>
                  <span className="text-wiki-text">{definition.description}</span>
                </li>
              )}
            </ul>
          </div>
        </CollapsibleSection>

        {/* Example Usages */}
        {usages.length > 0 && (
          <CollapsibleSection
            title={t('symbolWikiUsages')}
            icon={<ExternalLink size={16} />}
            expanded={expandedSections.has('usages')}
            onToggle={() => toggleSection('usages')}
            count={usages.length}
          >
            <div className="space-y-3">
              {usages.map((usage, i) => (
                <div
                  key={i}
                  className="border border-wiki-border rounded-md p-3 hover:border-wiki-link/40 transition-colors cursor-pointer"
                  onClick={() => onNavigate(usage.entity.id)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-wiki-text flex items-center gap-1.5">
                      <span
                        className="inline-block w-2 h-2 rounded-sm"
                        style={{ backgroundColor: TYPE_COLORS[usage.entity.type] }}
                      />
                      {usage.entity.name}
                      <span className="text-xs text-wiki-muted">({usage.relationType})</span>
                    </span>
                    <span className="text-xs text-wiki-muted">
                      {usage.entity.filePath.split('/').pop()}:{usage.entity.line}
                    </span>
                  </div>
                  <p className="text-xs text-wiki-muted">{usage.description}</p>
                  {usage.entity.signature && (
                    <pre className="mt-2 bg-[#161b22] rounded p-2 text-xs font-mono text-wiki-text overflow-x-auto">
                      {usage.entity.signature}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Notes */}
        {notes.length > 0 && (
          <CollapsibleSection
            title={t('symbolWikiNotes')}
            icon={<Info size={16} />}
            expanded={expandedSections.has('notes')}
            onToggle={() => toggleSection('notes')}
          >
            <div className="space-y-2">
              {notes.map((note, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 p-2.5 rounded-md text-sm ${
                    note.severity === 'warning'
                      ? 'bg-yellow-500/10 border border-yellow-500/20'
                      : 'bg-blue-500/10 border border-blue-500/20'
                  }`}
                >
                  {note.severity === 'warning'
                    ? <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />
                    : <Info size={14} className="text-blue-400 mt-0.5 shrink-0" />
                  }
                  <span className="text-wiki-text">{note.text}</span>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* See Also */}
        {seeAlso.length > 0 && (
          <CollapsibleSection
            title={t('symbolWikiSeeAlso')}
            icon={<Link2 size={16} />}
            expanded={expandedSections.has('seealso')}
            onToggle={() => toggleSection('seealso')}
            count={seeAlso.length}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {seeAlso.map((entry, i) => (
                <button
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-md border border-wiki-border hover:border-wiki-link/40 transition-colors text-left"
                  onClick={() => onNavigate(entry.entity.id)}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: TYPE_COLORS[entry.entity.type] }}
                  />
                  <span className="text-sm text-wiki-text truncate">{entry.entity.name}</span>
                  <span className="text-xs text-wiki-muted ml-auto shrink-0">{entry.relation}</span>
                </button>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Follow-up Questions */}
        {followUpQuestions.length > 0 && (
          <CollapsibleSection
            title={t('symbolWikiFollowUp')}
            icon={<HelpCircle size={16} />}
            expanded={expandedSections.has('questions')}
            onToggle={() => toggleSection('questions')}
          >
            <div className="space-y-2">
              {followUpQuestions.map((q, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-md border border-wiki-border text-sm text-wiki-text hover:border-wiki-link/40 transition-colors"
                >
                  {q}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  )
}

// ── Entity list for browsing ─────────────────────────────────────────

interface SymbolListProps {
  onSelect: (entityId: string) => void
}

export function SymbolList({ onSelect }: SymbolListProps) {
  const graph = useAppStore(s => s.currentProject?.ontologyGraph)
  useAppStore(s => s.locale)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<OntologyEntityType | 'all'>('all')

  const filtered = useMemo(() => {
    if (!graph) return []
    let entities = graph.entities.filter(e => e.type !== 'File' && e.type !== 'Module')
    if (typeFilter !== 'all') entities = entities.filter(e => e.type === typeFilter)
    if (search) {
      const q = search.toLowerCase()
      entities = entities.filter(e => e.name.toLowerCase().includes(q))
    }
    entities.sort((a, b) => {
      const aDeg = graph.relations.filter(r => r.source === a.id || r.target === a.id).length
      const bDeg = graph.relations.filter(r => r.source === b.id || r.target === b.id).length
      return bDeg - aDeg
    })
    return entities.slice(0, 100)
  }, [graph, search, typeFilter])

  const entityTypes: OntologyEntityType[] = [
    'Class', 'Interface', 'Function', 'Method', 'Component', 'Variable', 'Type', 'Enum',
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-wiki-border">
        <h2 className="text-lg font-semibold text-wiki-text mb-3 flex items-center gap-2">
          <BookOpen size={18} />
          {t('symbolWikiTitle')}
        </h2>
        <p className="text-sm text-wiki-muted mb-3">{t('symbolWikiDesc')}</p>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-wiki-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('symbolWikiSearch')}
            className="w-full bg-wiki-bg border border-wiki-border rounded-md pl-8 pr-3 py-1.5 text-sm text-wiki-text placeholder:text-wiki-muted focus:border-wiki-link focus:outline-none"
          />
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap gap-1">
          <FilterPill
            label="All"
            active={typeFilter === 'all'}
            onClick={() => setTypeFilter('all')}
          />
          {entityTypes.map(type => (
            <FilterPill
              key={type}
              label={type}
              active={typeFilter === type}
              onClick={() => setTypeFilter(type)}
              color={TYPE_COLORS[type]}
            />
          ))}
        </div>
      </div>

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-wiki-muted">
            {t('symbolWikiEmpty')}
          </div>
        ) : (
          <div className="divide-y divide-wiki-border">
            {filtered.map(entity => (
              <EntityRow key={entity.id} entity={entity} onClick={() => onSelect(entity.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────

function EntityRow({ entity, onClick }: { entity: OntologyEntity; onClick: () => void }) {
  const graph = useAppStore(s => s.currentProject?.ontologyGraph)
  const degree = useMemo(() => {
    if (!graph) return 0
    return graph.relations.filter(r => r.source === entity.id || r.target === entity.id).length
  }, [graph, entity.id])

  return (
    <button
      className="w-full text-left p-3 hover:bg-wiki-card/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: TYPE_COLORS[entity.type] }}
        />
        <span className="text-sm font-medium text-wiki-text">{entity.name}</span>
        <span className="text-xs text-wiki-muted">({entity.type})</span>
        <span className="ml-auto text-xs text-wiki-muted">{degree} rels</span>
      </div>
      <div className="text-xs text-wiki-muted mt-0.5 ml-5 truncate">
        {entity.filePath}:{entity.line}
        {entity.signature && ` — ${entity.signature}`}
      </div>
    </button>
  )
}

function MetaPill({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
      warn ? 'bg-yellow-500/15 text-yellow-400' : 'bg-wiki-card text-wiki-muted'
    }`}>
      {label}: <span className="font-medium">{value}</span>
    </span>
  )
}

function FilterPill({
  label, active, onClick, color,
}: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
        active
          ? 'bg-wiki-link/20 text-wiki-link border border-wiki-link/40'
          : 'bg-wiki-card text-wiki-muted border border-transparent hover:border-wiki-border'
      }`}
      onClick={onClick}
    >
      {color && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full mr-1"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </button>
  )
}

function CollapsibleSection({
  title, icon, expanded, onToggle, count, children,
}: {
  title: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  count?: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-4 border border-wiki-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-3 bg-wiki-card/30 hover:bg-wiki-card/50 transition-colors text-left"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-wiki-link">{icon}</span>
        <span className="text-sm font-semibold text-wiki-text">{title}</span>
        {count !== undefined && (
          <span className="ml-auto text-xs text-wiki-muted bg-wiki-card px-1.5 py-0.5 rounded">
            {count}
          </span>
        )}
      </button>
      {expanded && <div className="p-3">{children}</div>}
    </div>
  )
}
