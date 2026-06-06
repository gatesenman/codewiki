/**
 * Code Map — DeepWiki-style interactive code visualization.
 *
 * Three sub-views toggled via internal tabs:
 *   1. **Treemap** — file-system hierarchy sized by entity count, colored by coupling
 *   2. **Module Graph** — force-directed module dependency graph (directory-level)
 *   3. **File Explorer** — collapsible tree with per-file entity details
 *   4. **Architecture** — auto-generated Mermaid diagrams (module deps, class hierarchy, component flow)
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import * as d3 from 'd3'
import {
  LayoutGrid, GitBranch, FolderTree, ChevronRight, ChevronDown,
  FileText, FolderOpen, Box, Braces, Code, Hash, Database,
  ArrowUpRight, ArrowDownLeft, Share2,
} from 'lucide-react'
import { useAppStore } from '../store'
import {
  analyzeCodeMap,
  type CodeMapNode,
  type CodeMapData,

  type FileDetail,
  type EntitySummary,
} from '../services/codemap-analyzer'
import { generateAllDiagrams } from '../services/architecture-diagram'
import { MermaidDiagram } from './MermaidDiagram'
import { t } from '../services/i18n'
import type { OntologyEntityType } from '../types'

type SubView = 'treemap' | 'module-graph' | 'explorer' | 'architecture'

const ENTITY_COLORS: Record<OntologyEntityType, string> = {
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

function couplingColor(t01: number): string {
  const x = Math.max(0, Math.min(1, t01))
  return x <= 0.5
    ? d3.interpolateRgb('#3fb950', '#d29922')(x * 2)
    : d3.interpolateRgb('#d29922', '#f85149')((x - 0.5) * 2)
}

// ── Main component ──────────────────────────────────────────────────────

export function CodeMap() {
  const { currentProject, setSelectedEntityId } = useAppStore()
  useAppStore(s => s.locale)
  const [subView, setSubView] = useState<SubView>('treemap')
  const [selectedFile, setSelectedFile] = useState<FileDetail | null>(null)

  const data = useMemo<CodeMapData | null>(() => {
    const graph = currentProject?.ontologyGraph
    if (!graph || graph.entities.length === 0) return null
    return analyzeCodeMap(graph)
  }, [currentProject?.ontologyGraph])

  if (!currentProject || !data) {
    return (
      <div className="h-full flex items-center justify-center text-wiki-muted">
        <div className="text-center">
          <LayoutGrid size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{t('codeMapEmpty')}</p>
          <p className="text-sm mt-1">{t('codeMapEmptyHint')}</p>
        </div>
      </div>
    )
  }

  const SUB_TABS = [
    { key: 'treemap' as SubView, icon: LayoutGrid, labelKey: 'codeMapTreemap' as const },
    { key: 'module-graph' as SubView, icon: GitBranch, labelKey: 'codeMapModuleGraph' as const },
    { key: 'explorer' as SubView, icon: FolderTree, labelKey: 'codeMapExplorer' as const },
    { key: 'architecture' as SubView, icon: Share2, labelKey: 'codeMapArchitecture' as const },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Sub-tab bar + stats */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-wiki-border bg-wiki-sidebar/50">
        {SUB_TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setSubView(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                subView === tab.key
                  ? 'bg-wiki-accent/10 text-wiki-accent'
                  : 'text-wiki-muted hover:text-wiki-text hover:bg-wiki-card/50'
              }`}
            >
              <Icon size={14} />
              {t(tab.labelKey)}
            </button>
          )
        })}

        <div className="flex-1" />

        {/* Quick stats */}
        <div className="flex items-center gap-3 text-[11px] text-wiki-muted">
          <span>{data.stats.totalFiles} {t('codeMapFiles')}</span>
          <span>{data.stats.totalEntities} {t('codeMapEntities')}</span>
          <span>{data.stats.totalRelations} {t('codeMapRelations')}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {subView === 'treemap' && <TreemapView data={data} onSelectFile={setSelectedFile} />}
        {subView === 'module-graph' && <ModuleGraphView data={data} />}
        {subView === 'explorer' && (
          <ExplorerView
            data={data}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            onSelectEntity={setSelectedEntityId}
          />
        )}
        {subView === 'architecture' && (
          <ArchitectureView graph={currentProject.ontologyGraph} />
        )}
      </div>

      {/* File detail panel (bottom drawer) */}
      {selectedFile && subView !== 'explorer' && (
        <FileDetailDrawer file={selectedFile} onClose={() => setSelectedFile(null)} onSelectEntity={setSelectedEntityId} />
      )}
    </div>
  )
}

// ── Treemap view ────────────────────────────────────────────────────────

function TreemapView({ data, onSelectFile }: {
  data: CodeMapData
  onSelectFile: (f: FileDetail | null) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: CodeMapNode } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const width = el.clientWidth
    const height = el.clientHeight
    if (width === 0 || height === 0) return

    // Convert CodeMapNode tree to d3 hierarchy
    const root = d3.hierarchy(data.tree)
      .sum(d => d.type === 'file' ? Math.max(d.entityCount, 1) : 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    d3.treemap<CodeMapNode>()
      .size([width, height])
      .paddingTop(20)
      .paddingInner(2)
      .paddingOuter(3)
      .round(true)(root)

    // Clear previous
    d3.select(el).selectAll('*').remove()

    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')

    // Draw cells
    const leaves = root.leaves()

    const cell = svg.selectAll('g')
      .data(leaves)
      .join('g')
      .attr('transform', d => `translate(${(d as d3.HierarchyRectangularNode<CodeMapNode>).x0},${(d as d3.HierarchyRectangularNode<CodeMapNode>).y0})`)

    cell.append('rect')
      .attr('width', d => Math.max(0, (d as d3.HierarchyRectangularNode<CodeMapNode>).x1 - (d as d3.HierarchyRectangularNode<CodeMapNode>).x0))
      .attr('height', d => Math.max(0, (d as d3.HierarchyRectangularNode<CodeMapNode>).y1 - (d as d3.HierarchyRectangularNode<CodeMapNode>).y0))
      .attr('fill', d => couplingColor(d.data.coupling))
      .attr('fill-opacity', 0.8)
      .attr('stroke', '#30363d')
      .attr('stroke-width', 0.5)
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke', '#58a6ff').attr('stroke-width', 1.5)
        setTooltip({ x: event.pageX, y: event.pageY, node: d.data })
      })
      .on('mousemove', function (event) {
        setTooltip(prev => prev ? { ...prev, x: event.pageX, y: event.pageY } : null)
      })
      .on('mouseout', function () {
        d3.select(this).attr('fill-opacity', 0.8).attr('stroke', '#30363d').attr('stroke-width', 0.5)
        setTooltip(null)
      })
      .on('click', (_event, d) => {
        const fd = data.files.find(f => f.path === d.data.path)
        if (fd) onSelectFile(fd)
      })

    // Labels (only if cell is large enough)
    cell.append('text')
      .attr('x', 4)
      .attr('y', 14)
      .attr('fill', '#e6edf3')
      .attr('font-size', '10px')
      .attr('font-weight', 500)
      .text(d => {
        const w = (d as d3.HierarchyRectangularNode<CodeMapNode>).x1 - (d as d3.HierarchyRectangularNode<CodeMapNode>).x0
        const h = (d as d3.HierarchyRectangularNode<CodeMapNode>).y1 - (d as d3.HierarchyRectangularNode<CodeMapNode>).y0
        if (w < 50 || h < 20) return ''
        const name = d.data.name
        const maxChars = Math.floor(w / 6)
        return name.length > maxChars ? name.substring(0, maxChars - 1) + '…' : name
      })

    // Directory group labels
    const internalNodes = root.descendants().filter(d => d.depth > 0 && d.children)
    svg.selectAll('.dir-label')
      .data(internalNodes)
      .join('text')
      .attr('class', 'dir-label')
      .attr('x', d => (d as d3.HierarchyRectangularNode<CodeMapNode>).x0 + 4)
      .attr('y', d => (d as d3.HierarchyRectangularNode<CodeMapNode>).y0 + 14)
      .attr('fill', '#8b949e')
      .attr('font-size', '11px')
      .attr('font-weight', 600)
      .text(d => d.data.name)

  }, [data])

  return (
    <div ref={containerRef} className="w-full h-full bg-wiki-bg relative">
      {tooltip && (
        <div
          className="fixed z-50 px-3 py-2 rounded-lg bg-[#1c2128] border border-wiki-border shadow-lg text-xs pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="font-medium text-wiki-text mb-1">{tooltip.node.path}</div>
          <div className="text-wiki-muted">
            {tooltip.node.entityCount} entities · {tooltip.node.inDegree} in · {tooltip.node.outDegree} out
          </div>
          {Object.entries(tooltip.node.entityBreakdown).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {Object.entries(tooltip.node.entityBreakdown).map(([type, count]) => (
                <span key={type} className="flex items-center gap-0.5">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: ENTITY_COLORS[type as OntologyEntityType] }}
                  />
                  <span className="text-wiki-muted">{count} {type}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Module dependency graph ─────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  entityCount: number
  inDegree: number
  outDegree: number
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  weight: number
  dominantType: string
}

function ModuleGraphView({ data }: { data: CodeMapData }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const width = svgEl.clientWidth || 800
    const height = svgEl.clientHeight || 600

    // Build nodes from all directories that appear in dependencies
    const nodeIds = new Set<string>()
    for (const dep of data.dependencies) {
      nodeIds.add(dep.source)
      nodeIds.add(dep.target)
    }

    // Add top-level directories that might not have cross-deps but have entities
    const dirEntityCounts = new Map<string, number>()
    const dirInDeg = new Map<string, number>()
    const dirOutDeg = new Map<string, number>()
    for (const f of data.files) {
      const parts = f.path.split('/')
      const dir = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0]
      dirEntityCounts.set(dir, (dirEntityCounts.get(dir) || 0) + f.entities.length)
      dirInDeg.set(dir, (dirInDeg.get(dir) || 0) + f.inDegree)
      dirOutDeg.set(dir, (dirOutDeg.get(dir) || 0) + f.outDegree)
      nodeIds.add(dir)
    }

    const nodes: SimNode[] = [...nodeIds].map(id => ({
      id,
      entityCount: dirEntityCounts.get(id) || 0,
      inDegree: dirInDeg.get(id) || 0,
      outDegree: dirOutDeg.get(id) || 0,
    }))

    const nodeById = new Map(nodes.map(n => [n.id, n]))

    const links: SimLink[] = data.dependencies
      .filter(d => nodeById.has(d.source) && nodeById.has(d.target))
      .map(d => ({
        source: d.source,
        target: d.target,
        weight: d.weight,
        dominantType: d.dominantType,
      }))

    // Clear
    d3.select(svgEl).selectAll('*').remove()

    const svg = d3.select(svgEl)
    const g = svg.append('g')

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svg.call(zoom)

    // Node size scale
    const maxEntities = Math.max(...nodes.map(n => n.entityCount), 1)
    const sizeScale = d3.scaleSqrt().domain([0, maxEntities]).range([8, 35])

    // Simulation
    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>().radius(d => sizeScale(d.entityCount) + 5))

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#8b949e')

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#30363d')
      .attr('stroke-width', d => Math.min(d.weight, 6))
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', 'url(#arrowhead)')

    // Nodes
    const node = g.append('g')
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => sizeScale(d.entityCount))
      .attr('fill', d => {
        const totalDeg = d.inDegree + d.outDegree
        const maxDeg = Math.max(...nodes.map(n => n.inDegree + n.outDegree), 1)
        return couplingColor(totalDeg / maxDeg)
      })
      .attr('stroke', '#30363d')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseover', (event, d) => {
        setTooltip({
          x: event.pageX, y: event.pageY,
          text: `${d.id}\n${d.entityCount} entities · ${d.inDegree} in · ${d.outDegree} out`,
        })
      })
      .on('mouseout', () => setTooltip(null))
      .call(d3.drag<SVGCircleElement, SimNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0)
          d.fx = null; d.fy = null
        })
      )

    // Labels
    const label = g.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.id.split('/').pop() || d.id)
      .attr('font-size', '11px')
      .attr('font-weight', 500)
      .attr('fill', '#e6edf3')
      .attr('text-anchor', 'middle')
      .attr('dy', d => sizeScale(d.entityCount) + 14)
      .style('pointer-events', 'none')

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x || 0)
        .attr('y1', d => (d.source as SimNode).y || 0)
        .attr('x2', d => (d.target as SimNode).x || 0)
        .attr('y2', d => (d.target as SimNode).y || 0)
      node
        .attr('cx', d => d.x || 0)
        .attr('cy', d => d.y || 0)
      label
        .attr('x', d => d.x || 0)
        .attr('y', d => d.y || 0)
    })

    return () => { simulation.stop() }
  }, [data])

  return (
    <div className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full bg-wiki-bg" />
      {tooltip && (
        <div
          className="fixed z-50 px-3 py-2 rounded-lg bg-[#1c2128] border border-wiki-border shadow-lg text-xs pointer-events-none whitespace-pre-line"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <span className="text-wiki-text">{tooltip.text}</span>
        </div>
      )}
    </div>
  )
}

// ── Explorer view ───────────────────────────────────────────────────────

function ExplorerView({ data, selectedFile, onSelectFile, onSelectEntity }: {
  data: CodeMapData
  selectedFile: FileDetail | null
  onSelectFile: (f: FileDetail | null) => void
  onSelectEntity: (id: string | null) => void
}) {
  return (
    <div className="h-full flex">
      {/* Tree panel */}
      <div className="w-80 border-r border-wiki-border overflow-y-auto bg-wiki-sidebar/30">
        <div className="px-3 pt-3 pb-1">
          <h3 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">
            {t('codeMapFileTree')}
          </h3>
        </div>
        <TreeNodeItem
          node={data.tree}
          depth={0}
          files={data.files}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {selectedFile ? (
          <FileDetailPanel file={selectedFile} onSelectEntity={onSelectEntity} />
        ) : (
          <div className="h-full flex items-center justify-center text-wiki-muted text-sm">
            {t('codeMapSelectFile')}
          </div>
        )}
      </div>
    </div>
  )
}

function TreeNodeItem({ node, depth, files, selectedFile, onSelectFile }: {
  node: CodeMapNode
  depth: number
  files: FileDetail[]
  selectedFile: FileDetail | null
  onSelectFile: (f: FileDetail | null) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)

  if (node.type === 'file') {
    const fd = files.find(f => f.path === node.path)
    const isSelected = selectedFile?.path === node.path
    return (
      <button
        onClick={() => onSelectFile(fd || null)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-wiki-card/50 transition-colors ${
          isSelected ? 'bg-wiki-accent/10 text-wiki-accent' : 'text-wiki-text'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText size={12} className="shrink-0 text-wiki-muted" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-[10px] text-wiki-muted shrink-0">{node.entityCount}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs text-wiki-text hover:bg-wiki-card/50 transition-colors font-medium"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FolderOpen size={12} className="text-wiki-accent shrink-0" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-[10px] text-wiki-muted shrink-0">{node.entityCount}</span>
      </button>
      {expanded && node.children.map(child => (
        <TreeNodeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          files={files}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  )
}

// ── File detail panel (used in explorer and drawer) ─────────────────────

function FileDetailPanel({ file, onSelectEntity }: {
  file: FileDetail
  onSelectEntity: (id: string | null) => void
}) {
  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-wiki-text flex items-center gap-2">
          <FileText size={16} className="text-wiki-accent" />
          {file.name}
        </h2>
        <p className="text-xs text-wiki-muted mt-1">{file.path}</p>
        <div className="flex items-center gap-4 mt-2 text-xs text-wiki-muted">
          <span className="flex items-center gap-1">
            <ArrowDownLeft size={12} />
            {file.inDegree} {t('codeMapInbound')}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUpRight size={12} />
            {file.outDegree} {t('codeMapOutbound')}
          </span>
          <span>~{file.maxLine} {t('codeMapLines')}</span>
        </div>
      </div>

      {/* Entity list */}
      <h3 className="text-xs font-semibold text-wiki-muted uppercase tracking-wider mb-2">
        {t('codeMapEntitiesInFile')} ({file.entities.length})
      </h3>
      <div className="space-y-1">
        {file.entities
          .sort((a, b) => a.line - b.line)
          .map(entity => (
            <EntityRow key={entity.id} entity={entity} onSelect={onSelectEntity} />
          ))}
      </div>
    </div>
  )
}

function EntityRow({ entity, onSelect }: { entity: EntitySummary; onSelect: (id: string | null) => void }) {
  const Icon = ENTITY_ICONS[entity.type] || Code
  return (
    <button
      onClick={() => onSelect(entity.id)}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-xs hover:bg-wiki-card/50 transition-colors group border border-transparent hover:border-wiki-border"
    >
      <Icon
        size={14}
        className="shrink-0"
        style={{ color: ENTITY_COLORS[entity.type] }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-wiki-text group-hover:text-wiki-accent truncate">{entity.name}</span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            style={{
              backgroundColor: ENTITY_COLORS[entity.type] + '20',
              color: ENTITY_COLORS[entity.type],
            }}
          >
            {entity.type}
          </span>
        </div>
        {entity.signature && (
          <div className="text-[10px] text-wiki-muted truncate mt-0.5 font-mono">{entity.signature}</div>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-wiki-muted shrink-0">
        <span>L{entity.line}</span>
        {entity.callers > 0 && <span className="flex items-center gap-0.5"><ArrowDownLeft size={10} />{entity.callers}</span>}
        {entity.callees > 0 && <span className="flex items-center gap-0.5"><ArrowUpRight size={10} />{entity.callees}</span>}
      </div>
    </button>
  )
}

// ── Architecture diagrams view ──────────────────────────────────────────

function ArchitectureView({ graph }: { graph: import('../types').OntologyGraph }) {
  const diagrams = useMemo(() => generateAllDiagrams(graph), [graph])

  return (
    <div className="h-full overflow-y-auto px-6 py-4 space-y-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-wiki-text">{t('codeMapArchDiagrams')}</h2>
        <p className="text-xs text-wiki-muted mt-1">{t('codeMapArchDesc')}</p>
      </div>
      {diagrams.map(diagram => (
        <div key={diagram.type} className="rounded-lg border border-wiki-border bg-wiki-card/30 p-4">
          <h3 className="text-sm font-semibold text-wiki-text mb-3">{diagram.title}</h3>
          <MermaidDiagram chart={diagram.mermaid} />
        </div>
      ))}
    </div>
  )
}

// ── File detail drawer (for treemap/graph click-through) ────────────────

function FileDetailDrawer({ file, onClose, onSelectEntity }: {
  file: FileDetail
  onClose: () => void
  onSelectEntity: (id: string | null) => void
}) {
  return (
    <div className="border-t border-wiki-border bg-wiki-sidebar max-h-[40%] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b border-wiki-border">
        <span className="text-xs font-medium text-wiki-text">{file.path}</span>
        <button
          onClick={onClose}
          className="text-xs text-wiki-muted hover:text-wiki-text transition-colors px-2 py-0.5 rounded hover:bg-wiki-card"
        >
          ✕
        </button>
      </div>
      <FileDetailPanel file={file} onSelectEntity={onSelectEntity} />
    </div>
  )
}
