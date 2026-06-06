import { useEffect, useRef } from 'react'
import ForceGraph3D, { type ForceGraph3DInstance, type NodeObject } from '3d-force-graph'
import SpriteText from 'three-spritetext'
import type { Object3D } from 'three'
import type { GraphNode, GraphLink, OntologyEntityType } from '../types'

interface Graph3DProps {
  nodes: GraphNode[]
  links: GraphLink[]
  colors: Record<OntologyEntityType, string>
  sizes: Record<OntologyEntityType, number>
  selectedId: string | null
  nodeSize: number
  showLabels: boolean
  rotationSpeed: number
  forceStrength: number
  linkDistance: number
  onSelect: (id: string) => void
}

/** A node after the library merges our GraphNode fields onto its NodeObject. */
type N = NodeObject & GraphNode

/**
 * GitNexus-style 3D force-directed knowledge graph (three.js via 3d-force-graph).
 * Rendered instead of the 2D SVG when `graph.render3D` is enabled. The graph
 * data is deep-copied because the library mutates node/link references during
 * the force simulation.
 */
export function KnowledgeGraph3D({
  nodes, links, colors, sizes, selectedId,
  nodeSize, showLabels, rotationSpeed, forceStrength, linkDistance, onSelect,
}: Graph3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rotateRef = useRef(rotationSpeed)
  const selectRef = useRef(onSelect)
  rotateRef.current = rotationSpeed
  selectRef.current = onSelect

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const data = {
      nodes: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, filePath: n.filePath })),
      links: links.map(l => ({
        source: typeof l.source === 'string' ? l.source : l.source.id,
        target: typeof l.target === 'string' ? l.target : l.target.id,
      })),
    }

    const graph: ForceGraph3DInstance = new ForceGraph3D(el, { controlType: 'orbit' })

    graph
      .backgroundColor('#0d1117')
      .graphData(data)
      .nodeColor((n: NodeObject) => {
        const node = n as N
        return node.id === selectedId ? '#58a6ff' : (colors[node.type] || '#8b949e')
      })
      .nodeVal((n: NodeObject) => (sizes[(n as N).type] || 6) * nodeSize)
      .nodeOpacity(0.92)
      .nodeResolution(12)
      .nodeLabel((n: NodeObject) => {
        const node = n as N
        return `<div style="font:12px sans-serif;color:#fff;background:#1c2128;padding:4px 8px;border:1px solid #30363d;border-radius:6px">
          <b>${node.name}</b><br/><span style="color:#8b949e;font-size:10px">${node.type} · ${node.filePath || ''}</span></div>`
      })
      .linkColor(() => '#30363d')
      .linkOpacity(0.35)
      .linkWidth(0.5)
      .onNodeClick((n: NodeObject) => selectRef.current((n as N).id))
      .width(el.clientWidth)
      .height(el.clientHeight)

    // Apply configurable force physics.
    const chargeForce = graph.d3Force('charge')
    if (chargeForce) chargeForce.strength(forceStrength)
    const linkForce = graph.d3Force('link')
    if (linkForce) linkForce.distance(linkDistance)
    graph.d3ReheatSimulation()

    if (showLabels) {
      graph.nodeThreeObjectExtend(true).nodeThreeObject((n: NodeObject) => {
        const node = n as N
        const sprite = new SpriteText(node.name)
        sprite.color = '#c9d1d9'
        sprite.textHeight = 3
        // Lift the label above the sphere so it stays readable.
        ;(sprite as unknown as Object3D).position.set(0, (sizes[node.type] || 6) * nodeSize * 0.5 + 4, 0)
        return sprite as unknown as Object3D
      })
    }

    // Auto-orbit the camera when rotationSpeed > 0.
    let frame = 0
    let angle = 0
    const distance = 600
    const tick = () => {
      const speed = rotateRef.current
      if (speed > 0) {
        angle += speed * 0.002
        graph.cameraPosition({ x: distance * Math.sin(angle), z: distance * Math.cos(angle) })
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    const onResize = () => graph.width(el.clientWidth).height(el.clientHeight)
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      graph._destructor()
      el.innerHTML = ''
    }
  }, [nodes, links, colors, sizes, selectedId, nodeSize, showLabels, forceStrength, linkDistance])

  return <div ref={containerRef} className="flex-1 w-full bg-wiki-bg" />
}
