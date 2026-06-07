import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { ZoomIn, ZoomOut, Maximize2, Filter, Palette } from 'lucide-react'
import { useAppStore } from '../store'
import { OntologyBuilder } from '../services/ontology'
import { detectPatterns } from '../services/pattern-detector'
import { t, tEntityType, tEntityTypePlural } from '../services/i18n'
import { KnowledgeGraph3D } from './KnowledgeGraph3D'
import type { GraphNode, GraphLink, OntologyEntityType } from '../types'

type ColorMode = 'type' | 'coupling' | 'risk'

// Green → amber → red ramp for the coupling heatmap.
function couplingColor(t01: number): string {
  const x = Math.max(0, Math.min(1, t01))
  return x <= 0.5
    ? d3.interpolateRgb('#3fb950', '#d29922')(x * 2)
    : d3.interpolateRgb('#d29922', '#f85149')((x - 0.5) * 2)
}

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

const ENTITY_SIZES: Record<OntologyEntityType, number> = {
  Package: 12,
  Module: 10,
  File: 6,
  Class: 10,
  Interface: 9,
  Function: 7,
  Method: 6,
  Variable: 5,
  Type: 7,
  Enum: 7,
  Component: 10,
  Namespace: 10,
  Struct: 9,
  Trait: 9,
  Property: 5,
  Constant: 5,
  Constructor: 7,
  Decorator: 6,
  Hook: 7,
  Event: 6,
  TypeAlias: 7,
}

export function KnowledgeGraph() {
  const currentProject = useAppStore(s => s.currentProject)
  const selectedGraphNode = useAppStore(s => s.selectedGraphNode)
  const setSelectedGraphNode = useAppStore(s => s.setSelectedGraphNode)
  useAppStore(s => s.locale)
  const svgRef = useRef<SVGSVGElement>(null)
  const [filter, setFilter] = useState<OntologyEntityType | 'all'>('all')
  const [colorMode, setColorMode] = useState<ColorMode>('type')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null)
  // Set when 3D rendering fails (no WebGL / library crash) so we degrade to 2D.
  const [force2D, setForce2D] = useState(false)

  const ontology = currentProject?.ontologyGraph
  const graphCfg = useAppStore(s => s.config.graph)
  const render3D = graphCfg.render3D
  const use3D = render3D && !force2D

  // Re-attempt 3D whenever the user turns the setting back on.
  useEffect(() => {
    if (render3D) setForce2D(false)
  }, [render3D])

  // Per-node coupling degree + risk classification (for color modes).
  const { degree, maxDegree, riskById } = useMemo(() => {
    const deg = new Map<string, number>()
    const risk = new Map<string, 'anti' | 'pattern'>()
    if (!ontology) return { degree: deg, maxDegree: 1, riskById: risk }
    const DEP = new Set(['imports', 'dependsOn', 'calls', 'uses', 'extends', 'implements', 'references'])
    for (const r of ontology.relations) {
      if (!DEP.has(r.type)) continue
      deg.set(r.source, (deg.get(r.source) || 0) + 1)
      deg.set(r.target, (deg.get(r.target) || 0) + 1)
    }
    let mx = 1
    for (const v of deg.values()) if (v > mx) mx = v
    const pr = detectPatterns(ontology)
    for (const e of pr.entities) risk.set(e.entityId, e.tags.some(tg => tg.anti) ? 'anti' : 'pattern')
    return { degree: deg, maxDegree: mx, riskById: risk }
  }, [ontology])

  const nodeColor = useCallback((node: GraphNode): string => {
    if (colorMode === 'coupling') {
      return couplingColor((degree.get(node.id) || 0) / maxDegree)
    }
    if (colorMode === 'risk') {
      const r = riskById.get(node.id)
      return r === 'anti' ? '#f85149' : r === 'pattern' ? '#58a6ff' : '#6e7681'
    }
    return ENTITY_COLORS[node.type] || '#8b949e'
  }, [colorMode, degree, maxDegree, riskById])

  const buildGraph = useCallback(() => {
    if (use3D || !ontology || !svgRef.current) return

    const { nodes, links } = OntologyBuilder.toGraphVisualization(ontology)

    // Apply filter
    let filteredNodes = filter === 'all' ? nodes : nodes.filter(n => n.type === filter)

    // Cap to the configured maximum, keeping the most-connected nodes.
    if (graphCfg.maxNodes > 0 && filteredNodes.length > graphCfg.maxNodes) {
      const degree = new Map<string, number>()
      for (const l of links) {
        const s = typeof l.source === 'string' ? l.source : l.source.id
        const tg = typeof l.target === 'string' ? l.target : l.target.id
        degree.set(s, (degree.get(s) || 0) + 1)
        degree.set(tg, (degree.get(tg) || 0) + 1)
      }
      filteredNodes = [...filteredNodes]
        .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
        .slice(0, graphCfg.maxNodes)
    }

    const filteredNodeIds = new Set(filteredNodes.map(n => n.id))
    const filteredLinks = links.filter(
      l => filteredNodeIds.has(typeof l.source === 'string' ? l.source : l.source.id) &&
           filteredNodeIds.has(typeof l.target === 'string' ? l.target : l.target.id)
    )

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight

    const g = svg.append('g')

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })
    svg.call(zoom)

    // Force simulation
    const simulation = d3.forceSimulation(filteredNodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(filteredLinks)
        .id((d: unknown) => (d as GraphNode).id)
        .distance(graphCfg.linkDistance)
        .strength(0.5))
      .force('charge', d3.forceManyBody().strength(graphCfg.forceStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(graphCfg.collisionRadius))

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(filteredLinks)
      .join('line')
      .attr('stroke', '#30363d')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1)

    // Nodes
    const node = g.append('g')
      .selectAll('circle')
      .data(filteredNodes)
      .join('circle')
      .attr('r', (d: GraphNode) => (ENTITY_SIZES[d.type] || 6) * graphCfg.nodeSize)
      .attr('fill', (d: GraphNode) => nodeColor(d))
      .attr('stroke', '#0d1117')
      .attr('stroke-width', 1.5)
      .attr('cursor', 'pointer')
      .on('mouseover', function(event: MouseEvent, d: GraphNode) {
        d3.select(this).attr('stroke', '#58a6ff').attr('stroke-width', 3)
        setTooltip({ x: event.pageX, y: event.pageY, node: d })
      })
      .on('mouseout', function() {
        d3.select(this).attr('stroke', '#0d1117').attr('stroke-width', 1.5)
        setTooltip(null)
      })
      .on('click', (_event: MouseEvent, d: GraphNode) => {
        setSelectedGraphNode(d.id === selectedGraphNode ? null : d.id)
      })
      .call(d3.drag<SVGCircleElement, GraphNode>()
        .on('start', (event: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
        })
        .on('drag', (event: any) => {
          event.subject.fx = event.x
          event.subject.fy = event.y
        })
        .on('end', (event: any) => {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
        }) as any)

    // (2D) Labels
    const labels = g.append('g')
      .selectAll('text')
      .data(graphCfg.showLabels ? filteredNodes : [])
      .join('text')
      .text((d: GraphNode) => d.name)
      .attr('font-size', 9)
      .attr('fill', '#8b949e')
      .attr('dx', 12)
      .attr('dy', 4)
      .attr('pointer-events', 'none')

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y)

      labels
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y)
    })

    return () => simulation.stop()
  }, [ontology, filter, selectedGraphNode, setSelectedGraphNode, use3D, nodeColor,
      graphCfg.forceStrength, graphCfg.linkDistance, graphCfg.collisionRadius,
      graphCfg.maxNodes, graphCfg.nodeSize, graphCfg.showLabels])

  useEffect(() => {
    const cleanup = buildGraph()
    return () => { cleanup?.() }
  }, [buildGraph])

  if (!ontology || ontology.entities.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-wiki-muted">
        <p className="text-sm">{t('graphEmpty')}</p>
      </div>
    )
  }

  // Count entities by type
  const typeCounts: Partial<Record<OntologyEntityType, number>> = {}
  for (const e of ontology.entities) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-wiki-border bg-wiki-sidebar flex items-center gap-3">
        <Filter size={14} className="text-wiki-muted" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="text-xs bg-wiki-card border border-wiki-border rounded px-2 py-1 text-wiki-text"
        >
          <option value="all">{t('graphAllEntities')} ({ontology.entities.length})</option>
          {Object.entries(typeCounts).map(([type, count]) => (
            <option key={type} value={type}>{tEntityTypePlural(type as OntologyEntityType)} ({count})</option>
          ))}
        </select>

        <Palette size={14} className="text-wiki-muted" />
        <select
          value={colorMode}
          onChange={(e) => setColorMode(e.target.value as ColorMode)}
          className="text-xs bg-wiki-card border border-wiki-border rounded px-2 py-1 text-wiki-text"
          title={t('graphColorMode')}
        >
          <option value="type">{t('graphColorType')}</option>
          <option value="coupling">{t('graphColorCoupling')}</option>
          <option value="risk">{t('graphColorRisk')}</option>
        </select>

        <div className="flex-1" />

        {/* Legend (mode-aware) */}
        <div className="flex gap-3 text-[10px] text-wiki-muted">
          {colorMode === 'type' && Object.entries(ENTITY_COLORS)
            .filter(([type]) => typeCounts[type as OntologyEntityType])
            .map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                {tEntityType(type as OntologyEntityType)}
              </div>
            ))}
          {colorMode === 'coupling' && (
            <>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#3fb950' }} />{t('graphColorLow')}</div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#d29922' }} />{t('graphColorMed')}</div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f85149' }} />{t('graphColorHigh')}</div>
            </>
          )}
          {colorMode === 'risk' && (
            <>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f85149' }} />{t('graphColorAnti')}</div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#58a6ff' }} />{t('graphColorPattern')}</div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#6e7681' }} />{t('graphColorPlain')}</div>
            </>
          )}
        </div>
      </div>

      {/* 3D unavailable: degraded to 2D */}
      {render3D && force2D && (
        <div className="px-4 py-1.5 text-[11px] text-amber-500 bg-amber-500/10 border-b border-wiki-border">
          {t('graph3dFallback')}
        </div>
      )}

      {/* Graph canvas */}
      {use3D ? (
        <Graph3DCanvas filter={filter} onError={() => setForce2D(true)} />
      ) : (
        <svg ref={svgRef} className="flex-1 w-full bg-wiki-bg" />
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="graph-tooltip"
          style={{ left: tooltip.x + 10, top: tooltip.y - 40 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: ENTITY_COLORS[tooltip.node.type] }}
            />
            <span className="font-medium text-wiki-text">{tooltip.node.name}</span>
          </div>
          <div className="text-[10px] text-wiki-muted">
            {tEntityType(tooltip.node.type)} &bull; {tooltip.node.filePath}
          </div>
        </div>
      )}
    </div>
  )
}

/** Computes filtered graph data and renders the 3D (three.js) canvas. */
function Graph3DCanvas({ filter, onError }: { filter: OntologyEntityType | 'all'; onError: () => void }) {
  const currentProject = useAppStore(s => s.currentProject)
  const selectedGraphNode = useAppStore(s => s.selectedGraphNode)
  const setSelectedGraphNode = useAppStore(s => s.setSelectedGraphNode)
  const ontology = currentProject?.ontologyGraph
  const cfg = useAppStore(s => s.config.graph)
  if (!ontology) return null

  const { nodes, links } = OntologyBuilder.toGraphVisualization(ontology)
  let filteredNodes = filter === 'all' ? nodes : nodes.filter(n => n.type === filter)

  // Cap to the configured maximum, keeping the most-connected nodes.
  if (cfg.maxNodes > 0 && filteredNodes.length > cfg.maxNodes) {
    const degree = new Map<string, number>()
    for (const l of links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const tg = typeof l.target === 'string' ? l.target : l.target.id
      degree.set(s, (degree.get(s) || 0) + 1)
      degree.set(tg, (degree.get(tg) || 0) + 1)
    }
    filteredNodes = [...filteredNodes]
      .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
      .slice(0, cfg.maxNodes)
  }

  const ids = new Set(filteredNodes.map(n => n.id))
  const filteredLinks = links.filter(
    l => ids.has(typeof l.source === 'string' ? l.source : l.source.id) &&
         ids.has(typeof l.target === 'string' ? l.target : l.target.id)
  )

  return (
    <KnowledgeGraph3D
      nodes={filteredNodes}
      links={filteredLinks}
      colors={ENTITY_COLORS}
      sizes={ENTITY_SIZES}
      selectedId={selectedGraphNode}
      nodeSize={cfg.nodeSize}
      showLabels={cfg.showLabels}
      rotationSpeed={cfg.rotationSpeed}
      forceStrength={cfg.forceStrength}
      linkDistance={cfg.linkDistance}
      onSelect={(id) => setSelectedGraphNode(id === selectedGraphNode ? null : id)}
      onError={onError}
    />
  )
}
