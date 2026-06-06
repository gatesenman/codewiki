/**
 * CodeFlowMap — DeepWiki-style Codemaps visualization.
 *
 * Displays hierarchical code flow diagrams with:
 *   - Numbered steps (1a, 1b, 1c…) linked to code snippets
 *   - Collapsible sections for different flow paths
 *   - AI-generated suggestions for starting points
 *   - Save/search/manage saved codemaps
 */

import { useState, useMemo, useCallback } from 'react'
import {
  Map, ChevronDown, ChevronRight, FileText,
  Sparkles, Search, Star, ArrowLeft,
  Code, Box, Braces, Hash, FolderOpen, Database,
} from 'lucide-react'
import { useAppStore } from '../store'
import {
  generateCodeFlowMaps,
  suggestCodeFlows,
  buildFlowFromSeeds,
  type CodeFlowMap as FlowMapType,
  type CodeFlowSection,
  type CodeFlowStep,
  type CodeFlowSuggestion,
} from '../services/codeflow-analyzer'
import { t } from '../services/i18n'
import type { OntologyEntityType } from '../types'

const STEP_COLORS: Record<OntologyEntityType, string> = {
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

const STEP_ICONS: Record<OntologyEntityType, typeof Code> = {
  Module: FolderOpen,
  File: FileText,
  Class: Box,
  Interface: Braces,
  Function: Code,
  Method: Code,
  Variable: Hash,
  Type: Database,
  Enum: Database,
  Package: FolderOpen,
  Component: Box,
  Namespace: FolderOpen,
  Struct: Box,
  Trait: Braces,
  Property: Hash,
  Constant: Hash,
  Constructor: Code,
  Decorator: Code,
  Hook: Code,
  Event: Code,
  TypeAlias: Database,
}

export function CodeFlowMapView() {
  const graph = useAppStore(s => s.currentProject?.ontologyGraph)
  useAppStore(s => s.locale)

  const [selectedFlow, setSelectedFlow] = useState<FlowMapType | null>(null)
  const [savedFlows, setSavedFlows] = useState<FlowMapType[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  const autoFlows = useMemo(() => {
    if (!graph) return []
    return generateCodeFlowMaps(graph)
  }, [graph])

  const suggestions = useMemo(() => {
    if (!graph) return []
    return suggestCodeFlows(graph)
  }, [graph])

  const handleSuggestionClick = useCallback((suggestion: CodeFlowSuggestion) => {
    if (!graph) return
    const flow = buildFlowFromSeeds(
      graph,
      suggestion.seedEntityIds,
      suggestion.title,
      suggestion.description,
    )
    setSelectedFlow(flow)
  }, [graph])

  const handleSaveFlow = useCallback((flow: FlowMapType) => {
    setSavedFlows(prev => {
      if (prev.some(f => f.id === flow.id)) return prev
      return [...prev, flow]
    })
  }, [])

  if (selectedFlow) {
    return (
      <FlowMapDetail
        flow={selectedFlow}
        onBack={() => setSelectedFlow(null)}
        onSave={() => handleSaveFlow(selectedFlow)}
        isSaved={savedFlows.some(f => f.id === selectedFlow.id)}
      />
    )
  }

  return (
    <FlowMapList
      autoFlows={autoFlows}
      savedFlows={savedFlows}
      suggestions={suggestions}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      onSelectFlow={setSelectedFlow}
      onSuggestionClick={handleSuggestionClick}
    />
  )
}

// ── List view ────────────────────────────────────────────────────────

function FlowMapList({
  autoFlows, savedFlows, suggestions, searchTerm,
  onSearchChange, onSelectFlow, onSuggestionClick,
}: {
  autoFlows: FlowMapType[]
  savedFlows: FlowMapType[]
  suggestions: CodeFlowSuggestion[]
  searchTerm: string
  onSearchChange: (v: string) => void
  onSelectFlow: (f: FlowMapType) => void
  onSuggestionClick: (s: CodeFlowSuggestion) => void
}) {
  const filteredAuto = searchTerm
    ? autoFlows.filter(f => f.title.toLowerCase().includes(searchTerm.toLowerCase()))
    : autoFlows

  const filteredSaved = searchTerm
    ? savedFlows.filter(f => f.title.toLowerCase().includes(searchTerm.toLowerCase()))
    : savedFlows

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Map size={20} className="text-wiki-link" />
          <h2 className="text-lg font-semibold text-wiki-text">{t('codeflowTitle')}</h2>
        </div>
        <p className="text-sm text-wiki-muted mb-6">{t('codeflowDesc')}</p>

        {/* Search */}
        <div className="relative mb-6">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-wiki-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={t('codeflowSearch')}
            className="w-full bg-wiki-bg border border-wiki-border rounded-md pl-9 pr-3 py-2 text-sm text-wiki-text placeholder:text-wiki-muted focus:border-wiki-link focus:outline-none"
          />
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && !searchTerm && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-wiki-muted mb-3 flex items-center gap-1.5">
              <Sparkles size={14} />
              {t('codeflowSuggestions')}
            </h3>
            <div className="space-y-2">
              {suggestions.map((sug, i) => (
                <button
                  key={i}
                  className="w-full text-left p-3 rounded-lg border border-wiki-border hover:border-wiki-link/40 hover:bg-wiki-card/30 transition-colors"
                  onClick={() => onSuggestionClick(sug)}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-wiki-link shrink-0" />
                    <span className="text-sm font-medium text-wiki-text">{sug.title}</span>
                  </div>
                  <p className="text-xs text-wiki-muted mt-1 ml-6">{sug.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Saved Codemaps */}
        {filteredSaved.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-wiki-muted mb-3 flex items-center gap-1.5">
              <Star size={14} />
              {t('codeflowSaved')}
            </h3>
            <div className="space-y-2">
              {filteredSaved.map(flow => (
                <FlowCard key={flow.id} flow={flow} onClick={() => onSelectFlow(flow)} />
              ))}
            </div>
          </div>
        )}

        {/* Auto-generated flows */}
        {filteredAuto.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-wiki-muted mb-3 flex items-center gap-1.5">
              <Code size={14} />
              {t('codeflowGenerated')}
            </h3>
            <div className="space-y-2">
              {filteredAuto.map(flow => (
                <FlowCard key={flow.id} flow={flow} onClick={() => onSelectFlow(flow)} />
              ))}
            </div>
          </div>
        )}

        {filteredAuto.length === 0 && filteredSaved.length === 0 && (
          <div className="text-center py-12 text-wiki-muted text-sm">
            {t('codeflowEmpty')}
          </div>
        )}
      </div>
    </div>
  )
}

function FlowCard({ flow, onClick }: { flow: FlowMapType; onClick: () => void }) {
  return (
    <button
      className="w-full text-left p-3 rounded-lg border border-wiki-border hover:border-wiki-link/40 hover:bg-wiki-card/30 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-wiki-text">{flow.title}</span>
        <ChevronRight size={14} className="text-wiki-muted" />
      </div>
      <p className="text-xs text-wiki-muted mt-1">{flow.description}</p>
      <div className="flex items-center gap-3 mt-2 text-xs text-wiki-muted">
        <span>{flow.sections.length} sections</span>
        <span>{flow.entityCount} entities</span>
      </div>
    </button>
  )
}

// ── Detail view ──────────────────────────────────────────────────────

function FlowMapDetail({
  flow, onBack, onSave, isSaved,
}: {
  flow: FlowMapType
  onBack: () => void
  onSave: () => void
  isSaved: boolean
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set())

  const toggleSection = (sectionNum: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionNum)) next.delete(sectionNum)
      else next.add(sectionNum)
      return next
    })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={onBack}
            className="p-1.5 rounded-md hover:bg-wiki-card text-wiki-muted hover:text-wiki-text transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm text-wiki-muted">{t('codeflowTitle')}</span>
        </div>

        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold text-wiki-text">{flow.title}</h1>
          <button
            onClick={onSave}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${
              isSaved
                ? 'bg-yellow-500/15 text-yellow-400'
                : 'bg-wiki-card text-wiki-muted hover:text-wiki-text'
            }`}
          >
            <Star size={12} fill={isSaved ? 'currentColor' : 'none'} />
            {isSaved ? t('codeflowSavedLabel') : t('codeflowSaveLabel')}
          </button>
        </div>
        <p className="text-sm text-wiki-muted mb-6">{flow.description}</p>

        {/* Sections */}
        {flow.sections.map(section => (
          <FlowSection
            key={section.sectionNumber}
            section={section}
            collapsed={collapsedSections.has(section.sectionNumber)}
            onToggle={() => toggleSection(section.sectionNumber)}
          />
        ))}
      </div>
    </div>
  )
}

function FlowSection({
  section, collapsed, onToggle,
}: {
  section: CodeFlowSection
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="mb-4">
      {/* Section header */}
      <button
        className="w-full flex items-center gap-2 p-3 rounded-t-lg bg-wiki-card/40 hover:bg-wiki-card/60 transition-colors text-left border border-wiki-border"
        onClick={onToggle}
      >
        <span className="text-wiki-link font-bold text-sm w-6">{section.sectionNumber}</span>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="text-sm font-semibold text-wiki-text">{section.title}</span>
        <span className="ml-auto text-xs text-wiki-muted">{section.description}</span>
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="border border-t-0 border-wiki-border rounded-b-lg overflow-hidden">
          {section.steps.map((step, idx) => (
            <StepRow key={idx} step={step} isLast={idx === section.steps.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function StepRow({ step, isLast }: { step: CodeFlowStep; isLast: boolean }) {
  const Icon = STEP_ICONS[step.entityType] ?? Code
  const color = STEP_COLORS[step.entityType]
  const indentPx = step.depth * 24

  return (
    <div className={`flex ${!isLast ? 'border-b border-wiki-border/50' : ''}`}>
      {/* Tree line connector */}
      <div className="w-16 shrink-0 relative flex items-stretch">
        {/* Vertical line */}
        <div className="absolute left-8 top-0 bottom-0 w-px bg-wiki-border" />
        {/* Horizontal branch */}
        <div className="absolute left-8 top-1/2 w-3 h-px bg-wiki-border" />
        {/* Step badge */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center">
          <span
            className="text-xs font-bold px-1 py-0.5 rounded"
            style={{ color, backgroundColor: `${color}15` }}
          >
            {step.stepId}
          </span>
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 py-2.5 pr-3 min-w-0"
        style={{ paddingLeft: `${indentPx}px` }}
      >
        <div className="flex items-center gap-2 mb-0.5">
          <Icon size={13} style={{ color }} />
          <span className="text-sm font-medium text-wiki-text">{step.label}</span>
          <span className="ml-auto text-xs text-wiki-muted shrink-0">{step.fileRef}</span>
        </div>
        {step.codeSnippet && (
          <pre className="mt-1 bg-[#161b22] rounded p-2 text-xs font-mono text-wiki-text overflow-x-auto">
            {step.codeSnippet}
          </pre>
        )}
      </div>
    </div>
  )
}
