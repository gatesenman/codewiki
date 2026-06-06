import { useState } from 'react'
import {
  FileText, ChevronRight, ChevronDown, FolderOpen,
  Hash, Box, Braces, Code, Database,
} from 'lucide-react'
import { useAppStore } from '../store'
import { t, tEntityTypePlural } from '../services/i18n'
import type { WikiPage, OntologyEntity, OntologyEntityType } from '../types'

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

export function Sidebar() {
  const {
    currentProject, activePageId, setActivePageId,
    sidebarCollapsed, viewMode, setViewMode,
  } = useAppStore()
  useAppStore(s => s.locale)

  if (sidebarCollapsed) return null

  const wikiPages = currentProject?.wikiPages || []
  const ontology = currentProject?.ontologyGraph

  return (
    <div className="w-64 h-full bg-wiki-sidebar border-r border-wiki-border flex flex-col overflow-hidden">
      {/* Wiki Pages */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">
            {t('sidebarWikiPages')}
          </h3>
        </div>
        {wikiPages.length === 0 ? (
          <div className="px-3 py-4 text-xs text-wiki-muted/60 text-center">
            {t('sidebarNoWikiPages')}<br/>{t('sidebarGenerateHint')}
          </div>
        ) : (
          <div className="px-1.5 pb-2">
            {wikiPages
              .sort((a, b) => a.order - b.order)
              .map(page => (
                <WikiPageItem
                  key={page.id}
                  page={page}
                  isActive={activePageId === page.id}
                  onClick={() => {
                    setActivePageId(page.id)
                    if (viewMode !== 'wiki') setViewMode('wiki')
                  }}
                />
              ))}
          </div>
        )}

        {/* Ontology Entities */}
        {ontology && ontology.entities.length > 0 && (
          <>
            <div className="px-3 pt-4 pb-1 border-t border-wiki-border">
              <h3 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">
                {t('sidebarCodeEntities')} ({ontology.entities.length})
              </h3>
            </div>
            <OntologyTree />
          </>
        )}
      </div>

      {/* Stats footer */}
      {currentProject && (
        <div className="px-3 py-2 border-t border-wiki-border bg-wiki-bg/50">
          <div className="flex items-center justify-between text-[10px] text-wiki-muted/60">
            <span>{ontology?.entities.length || 0} {t('footerEntities')}</span>
            <span>{ontology?.relations.length || 0} {t('footerRelations')}</span>
            <span>{wikiPages.length} {t('footerPages')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function WikiPageItem({ page, isActive, onClick }: { page: WikiPage; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`sidebar-item w-full ${isActive ? 'active' : ''}`}
    >
      <FileText size={14} />
      <span className="truncate">{page.title}</span>
    </button>
  )
}

function OntologyTree() {
  const ontology = useAppStore(s => s.currentProject?.ontologyGraph)
  const selectedEntityId = useAppStore(s => s.selectedEntityId)
  const setSelectedEntityId = useAppStore(s => s.setSelectedEntityId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!ontology) return null

  // Group entities by type, deduplicated by name
  const byType = new Map<OntologyEntityType, typeof ontology.entities>()
  const seenNames = new Map<string, Set<string>>() // type → set of names
  for (const entity of ontology.entities) {
    if (entity.type === 'File') continue // skip file-level entities in sidebar
    const nameSet = seenNames.get(entity.type) || new Set()
    if (nameSet.has(entity.name)) continue // skip duplicate names within same type
    nameSet.add(entity.name)
    seenNames.set(entity.type, nameSet)
    const list = byType.get(entity.type) || []
    list.push(entity)
    byType.set(entity.type, list)
  }

  const toggle = (type: string) => {
    const next = new Set(expanded)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setExpanded(next)
  }

  return (
    <div className="px-1.5 pb-2">
      {Array.from(byType.entries()).map(([type, entities]) => {
        const Icon = ENTITY_ICONS[type] || Box
        const isOpen = expanded.has(type)
        return (
          <div key={type}>
            <button
              onClick={() => toggle(type)}
              className="sidebar-item w-full"
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Icon size={14} />
              <span className="truncate">{tEntityTypePlural(type)}</span>
              <span className="ml-auto text-[10px] text-wiki-muted/60">{entities.length}</span>
            </button>
            {isOpen && (
              <div className="ml-4">
                {entities.slice(0, 50).map(entity => (
                  <button
                    key={entity.id}
                    onClick={() => setSelectedEntityId(entity.id)}
                    className={`sidebar-item w-full text-[11px] py-1 text-left ${
                      selectedEntityId === entity.id ? 'bg-wiki-accent/10 text-wiki-accent' : ''
                    }`}
                    title={`${entity.filePath}:${entity.line}`}
                  >
                    <span className="truncate">{entity.name}</span>
                  </button>
                ))}
                {entities.length > 50 && (
                  <div className="sidebar-item text-[10px] py-0.5 text-wiki-muted/50">
                    +{entities.length - 50} {t('more')}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
