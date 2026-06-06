import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { t } from '../services/i18n'
import { useAppStore } from '../store'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#1c2128',
    primaryTextColor: '#e6edf3',
    primaryBorderColor: '#30363d',
    lineColor: '#58a6ff',
    secondaryColor: '#161b22',
    tertiaryColor: '#0d1117',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '14px',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
  },
})

interface Props {
  chart: string
}

export function MermaidDiagram({ chart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useAppStore(s => s.locale)
  const [error, setError] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      if (!containerRef.current) return

      try {
        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`
        const { svg } = await mermaid.render(id, chart)
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg
          setError(null)
          setRendered(true)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('mermaidRenderFailed'))
        }
      }
    }
    render()
    return () => { cancelled = true }
  }, [chart])

  if (error) {
    return (
      <div className="my-4 p-4 rounded-lg bg-wiki-card border border-wiki-border">
        <div className="text-xs text-wiki-muted mb-2">{t('mermaidRaw')}</div>
        <pre className="text-xs text-wiki-text/70 overflow-x-auto">
          <code>{chart}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="my-6 flex justify-center">
      <div
        ref={containerRef}
        className={`bg-wiki-card/50 rounded-lg p-4 border border-wiki-border max-w-full overflow-x-auto transition-opacity ${
          rendered ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}
