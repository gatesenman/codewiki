import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { ZoomIn, ZoomOut, Maximize2, Filter } from 'lucide-react'
import { useAppStore } from '../store'
import { OntologyBuilder } from '../services/ontology'
import { configManager } from '../services/config-manager'
import { t, tEntityType, tEntityTypePlural } from '../services/i18n'
import { KnowledgeGraph3D } from './KnowledgeGraph3D'
import type { GraphNode, GraphLink, OntologyEntityType } from '../types'

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
}

export function KnowledgeGraph() {
  const { currentProject, selectedGraphNode, setSelectedGraphNode } = useAppStore()
  useAppStore(s => s.locale)
  const svgRef = useRef<SVGSVGElement>(null)
  const [filter, setFilter] = useState<OntologyEntityType | 'all'>('all')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null)

  const ontology = currentProject?.ontologyGraph
  const graphCfg = configManager.getConfig().graph
  const render3D = graphCfg.render3D

  const buildGraph = useCallback(() => {
    if (render3D || !ontology || !svgRef.current) return

    const { nodes, links } = OntologyBuilder.toGraphVisualization(ontology)

    // Apply filter
    const filteredNodes = filter === 'all' ? nodes : nodes.filter(n => n.type === filter)
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
        .distance(80)
        .strength(0.5))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(20))

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
      .attr('r', (d: GraphNode) => ENTITY_SIZES[d.type] || 6)
      .attr('fill', (d: GraphNode) => ENTITY_COLORS[d.type] || '#8b949e')
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
      .data(filteredNodes)
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
  }, [ontology, filter, selectedGraphNode, setSelectedGraphNode, render3D])

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

        <div className="flex-1" />

        {/* Legend */}
        <div className="flex gap-3 text-[10px] text-wiki-muted">
          {Object.entries(ENTITY_COLORS)
            .filter(([type]) => typeCounts[type as OntologyEntityType])
            .map(([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                {tEntityType(type as OntologyEntityType)}
              </div>
            ))}
        </div>
      </div>

      {/* Graph canvas */}
      {render3D ? (
        <Graph3DCanvas filter={filter} />
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
function Graph3DCanvas({ filter }: { filter: OntologyEntityType | 'all' }) {
  const { currentProject, selectedGraphNode, setSelectedGraphNode } = useAppStore()
  const ontology = currentProject?.ontologyGraph
  const cfg = configManager.getConfig().graph
  if (!ontology) return null

  const { nodes, links } = OntologyBuilder.toGraphVisualization(ontology)
  const filteredNodes = filter === 'all' ? nodes : nodes.filter(n => n.type === filter)
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
      onSelect={(id) => setSelectedGraphNode(id === selectedGraphNode ? null : id)}
    />
  )
}
