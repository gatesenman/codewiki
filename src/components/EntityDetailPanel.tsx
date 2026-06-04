import { useState, useEffect, useCallback } from 'react'
import {
  X, Box, Code, FileText, ArrowRight, ArrowLeft,
  AlertTriangle, Copy, ExternalLink, Braces,
  FolderOpen, Hash, Database,
} from 'lucide-react'
import { useAppStore } from '../store'
import type { OntologyEntity, OntologyRelation, OntologyEntityType } from '../types'

const ENTITY_ICONS: Record<OntologyEntityType, typeof Box> = {
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
}

const TYPE_COLORS: Record<OntologyEntityType, string> = {
  Module: 'text-wiki-orange',
  File: 'text-wiki-muted',
  Class: 'text-wiki-accent',
  Interface: 'text-wiki-purple',
  Function: 'text-wiki-green',
  Method: 'text-wiki-green',
  Variable: 'text-wiki-orange',
  Type: 'text-wiki-purple',
  Enum: 'text-wiki-orange',
  Package: 'text-wiki-muted',
  Component: 'text-wiki-accent',
}

export function EntityDetailPanel() {
  const { currentProject, selectedEntityId, setSelectedEntityId } = useAppStore()
  const [sourceCode, setSourceCode] = useState<string | null>(null)
  const [loadingSource, setLoadingSource] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'source' | 'relations' | 'impact'>('info')

  const ontology = currentProject?.ontologyGraph
  const entity = ontology?.entities.find(e => e.id === selectedEntityId)

  // Load source code when entity changes
  useEffect(() => {
    if (!entity) return
    setSourceCode(null)
    loadSourceCode(entity)
  }, [entity?.id])

  const loadSourceCode = useCallback(async (ent: OntologyEntity) => {
    setLoadingSource(true)
    try {
      if (window.electronAPI?.readFile) {
        const content = await window.electronAPI.readFile(ent.filePath)
        if (content) {
          const lines = content.split('\n')
          const start = Math.max(0, ent.line - 1)
          const end = Math.min(lines.length, ent.endLine)
          setSourceCode(lines.slice(start, end).join('\n'))
        }
      } else {
        setSourceCode(`// Source code preview requires Electron desktop app\n// File: ${ent.filePath}\n// Lines: ${ent.line}-${ent.endLine}`)
      }
    } catch {
      setSourceCode(`// Failed to load source code\n// ${ent.filePath}:${ent.line}`)
    } finally {
      setLoadingSource(false)
    }
  }, [])

  if (!entity || !ontology) return null

  // Get relations
  const outgoing = ontology.relations.filter(r => r.source === entity.id)
  const incoming = ontology.relations.filter(r => r.target === entity.id)

  // BFS impact analysis (depth 2)
  const impactEntities = computeImpact(entity.id, ontology.relations, ontology.entities, 2)

  const Icon = ENTITY_ICONS[entity.type] || Box
  const colorClass = TYPE_COLORS[entity.type] || 'text-wiki-text'

  return (
    <div className="h-full flex flex-col bg-wiki-bg border-l border-wiki-border w-[400px] min-w-[360px]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-wiki-border bg-wiki-sidebar flex items-center gap-2">
        <Icon size={18} className={colorClass} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-wiki-text truncate">{entity.name}</h3>
          <p className="text-[10px] text-wiki-muted truncate">{entity.filePath}:{entity.line}-{entity.endLine}</p>
        </div>
        <button
          onClick={() => setSelectedEntityId(null)}
          className="p-1 rounded hover:bg-wiki-border/50 text-wiki-muted hover:text-wiki-text transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-wiki-border bg-wiki-sidebar/50">
        {([
          { id: 'info', label: 'Info' },
          { id: 'source', label: 'Source' },
          { id: 'relations', label: `Relations (${outgoing.length + incoming.length})` },
          { id: 'impact', label: `Impact (${impactEntities.length})` },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-wiki-accent text-wiki-accent'
                : 'border-transparent text-wiki-muted hover:text-wiki-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'info' && <InfoTab entity={entity} outgoing={outgoing} incoming={incoming} />}
        {activeTab === 'source' && <SourceTab code={sourceCode} loading={loadingSource} entity={entity} />}
        {activeTab === 'relations' && (
          <RelationsTab
            outgoing={outgoing}
            incoming={incoming}
            entities={ontology.entities}
            onEntityClick={(id) => setSelectedEntityId(id)}
          />
        )}
        {activeTab === 'impact' && (
          <ImpactTab
            impactEntities={impactEntities}
            onEntityClick={(id) => setSelectedEntityId(id)}
          />
        )}
      </div>
    </div>
  )
}

// --- Info Tab ---
function InfoTab({ entity, outgoing, incoming }: {
  entity: OntologyEntity
  outgoing: OntologyRelation[]
  incoming: OntologyRelation[]
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Basic Info */}
      <section>
        <h4 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">Details</h4>
        <div className="space-y-2">
          <InfoRow label="Type" value={entity.type} />
          <InfoRow label="Name" value={entity.name} />
          <InfoRow label="File" value={entity.filePath} mono />
          <InfoRow label="Lines" value={`${entity.line} – ${entity.endLine}`} />
          {entity.signature && <InfoRow label="Signature" value={entity.signature} mono />}
          {entity.description && <InfoRow label="Description" value={entity.description} />}
        </div>
      </section>

      {/* Properties */}
      {entity.properties && Object.keys(entity.properties).length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">Properties</h4>
          <div className="space-y-1">
            {Object.entries(entity.properties).map(([key, val]) => (
              <InfoRow key={key} label={key} value={val} />
            ))}
          </div>
        </section>
      )}

      {/* Summary stats */}
      <section>
        <h4 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">Connections</h4>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Outgoing" value={outgoing.length} color="text-wiki-green" />
          <StatCard label="Incoming" value={incoming.length} color="text-wiki-accent" />
        </div>
      </section>
    </div>
  )
}

// --- Source Tab ---
function SourceTab({ code, loading, entity }: { code: string | null; loading: boolean; entity: OntologyEntity }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (code) {
      navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-wiki-muted font-mono">
          {entity.filePath}:{entity.line}-{entity.endLine}
        </span>
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-wiki-border/50 text-wiki-muted hover:text-wiki-text transition-colors"
          title="Copy source"
        >
          <Copy size={14} />
        </button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-wiki-muted text-sm">Loading source code...</div>
      ) : code ? (
        <pre className="p-3 rounded-lg bg-wiki-card border border-wiki-border text-xs font-mono text-wiki-text overflow-x-auto whitespace-pre leading-5">
          {code.split('\n').map((line, i) => (
            <div key={i} className="flex">
              <span className="text-wiki-muted/40 select-none w-8 text-right mr-3 shrink-0">
                {entity.line + i}
              </span>
              <span>{line}</span>
            </div>
          ))}
        </pre>
      ) : (
        <div className="text-center py-8 text-wiki-muted text-sm">
          No source available in browser mode.
          <br />
          <span className="text-[10px]">Source preview works in Electron desktop app.</span>
        </div>
      )}
      {copied && (
        <div className="mt-2 text-xs text-wiki-green">Copied to clipboard!</div>
      )}
    </div>
  )
}

// --- Relations Tab ---
function RelationsTab({ outgoing, incoming, entities, onEntityClick }: {
  outgoing: OntologyRelation[]
  incoming: OntologyRelation[]
  entities: OntologyEntity[]
  onEntityClick: (id: string) => void
}) {
  const findEntity = (id: string) => entities.find(e => e.id === id)

  return (
    <div className="p-4 space-y-4">
      {/* Outgoing */}
      {outgoing.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2 flex items-center gap-1">
            <ArrowRight size={12} className="text-wiki-green" />
            Outgoing ({outgoing.length})
          </h4>
          <div className="space-y-1">
            {outgoing.map(rel => {
              const target = findEntity(rel.target)
              if (!target) return null
              return (
                <RelationRow
                  key={rel.id}
                  relationType={rel.type}
                  entity={target}
                  direction="out"
                  onClick={() => onEntityClick(target.id)}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Incoming */}
      {incoming.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2 flex items-center gap-1">
            <ArrowLeft size={12} className="text-wiki-accent" />
            Incoming ({incoming.length})
          </h4>
          <div className="space-y-1">
            {incoming.map(rel => {
              const source = findEntity(rel.source)
              if (!source) return null
              return (
                <RelationRow
                  key={rel.id}
                  relationType={rel.type}
                  entity={source}
                  direction="in"
                  onClick={() => onEntityClick(source.id)}
                />
              )
            })}
          </div>
        </section>
      )}

      {outgoing.length === 0 && incoming.length === 0 && (
        <div className="text-center py-8 text-wiki-muted text-sm">
          No relations found for this entity.
        </div>
      )}
    </div>
  )
}

// --- Impact Tab ---
function ImpactTab({ impactEntities, onEntityClick }: {
  impactEntities: { entity: OntologyEntity; depth: number; path: string[] }[]
  onEntityClick: (id: string) => void
}) {
  const byDepth = new Map<number, typeof impactEntities>()
  for (const item of impactEntities) {
    const list = byDepth.get(item.depth) || []
    list.push(item)
    byDepth.set(item.depth, list)
  }

  return (
    <div className="p-4 space-y-4">
      {impactEntities.length > 0 ? (
        <>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-wiki-orange/10 border border-wiki-orange/20">
            <AlertTriangle size={14} className="text-wiki-orange shrink-0" />
            <span className="text-xs text-wiki-orange">
              {impactEntities.length} entities may be affected by changes
            </span>
          </div>

          {Array.from(byDepth.entries()).sort(([a], [b]) => a - b).map(([depth, items]) => (
            <section key={depth}>
              <h4 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">
                Depth {depth} ({items.length} entities)
              </h4>
              <div className="space-y-1">
                {items.slice(0, 20).map(item => {
                  const Icon = ENTITY_ICONS[item.entity.type] || Box
                  const color = TYPE_COLORS[item.entity.type]
                  return (
                    <button
                      key={item.entity.id}
                      onClick={() => onEntityClick(item.entity.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-wiki-card transition-colors group"
                    >
                      <Icon size={12} className={color} />
                      <span className="text-xs text-wiki-text group-hover:text-wiki-accent truncate">
                        {item.entity.name}
                      </span>
                      <span className="ml-auto text-[10px] text-wiki-muted/50 font-mono shrink-0">
                        {item.entity.type}
                      </span>
                    </button>
                  )
                })}
                {items.length > 20 && (
                  <div className="text-[10px] text-wiki-muted/50 px-2">+{items.length - 20} more</div>
                )}
              </div>
            </section>
          ))}
        </>
      ) : (
        <div className="text-center py-8 text-wiki-muted text-sm">
          No downstream impact detected (isolated entity).
        </div>
      )}
    </div>
  )
}

// --- Helper Components ---
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] text-wiki-muted w-20 shrink-0">{label}</span>
      <span className={`text-[11px] text-wiki-text break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-2 rounded-lg bg-wiki-card border border-wiki-border text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-wiki-muted">{label}</div>
    </div>
  )
}

function RelationRow({ relationType, entity, direction, onClick }: {
  relationType: string
  entity: OntologyEntity
  direction: 'in' | 'out'
  onClick: () => void
}) {
  const Icon = ENTITY_ICONS[entity.type] || Box
  const color = TYPE_COLORS[entity.type]
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-wiki-card transition-colors group"
    >
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
        direction === 'out' ? 'bg-wiki-green/10 text-wiki-green' : 'bg-wiki-accent/10 text-wiki-accent'
      }`}>
        {relationType}
      </span>
      <Icon size={12} className={color} />
      <span className="text-xs text-wiki-text group-hover:text-wiki-accent truncate">{entity.name}</span>
      <span className="ml-auto text-[10px] text-wiki-muted/50 font-mono shrink-0">{entity.type}</span>
    </button>
  )
}

// --- Impact Analysis Helper ---
function computeImpact(
  entityId: string,
  relations: OntologyRelation[],
  entities: OntologyEntity[],
  maxDepth: number
): { entity: OntologyEntity; depth: number; path: string[] }[] {
  const visited = new Set<string>([entityId])
  const result: { entity: OntologyEntity; depth: number; path: string[] }[] = []
  const queue: { id: string; depth: number; path: string[] }[] = [{ id: entityId, depth: 0, path: [] }]

  while (queue.length > 0) {
    const { id, depth, path } = queue.shift()!
    if (depth >= maxDepth) continue

    // Find entities that depend on current entity (incoming relations = dependents)
    const dependents = relations.filter(r => r.target === id || r.source === id)
    for (const rel of dependents) {
      const neighborId = rel.source === id ? rel.target : rel.source
      if (visited.has(neighborId)) continue
      visited.add(neighborId)

      const neighborEntity = entities.find(e => e.id === neighborId)
      if (neighborEntity && neighborEntity.type !== 'File') {
        const newPath = [...path, rel.type]
        result.push({ entity: neighborEntity, depth: depth + 1, path: newPath })
        queue.push({ id: neighborId, depth: depth + 1, path: newPath })
      }
    }
  }

  return result
}
