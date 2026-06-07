import { useEffect, useRef, useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { BookOpen, Clock, FileText, ChevronLeft, ChevronRight, ShieldCheck, Download } from 'lucide-react'
import { useAppStore } from '../store'
import { MermaidDiagram } from './MermaidDiagram'
import { validateWikiPage } from '../services/wiki-generator'
import { exportWiki, type ExportFormat } from '../services/wiki-export'
import { t } from '../services/i18n'
import { getCodeTheme, wrapClass } from '../services/code-style'

export function WikiViewer() {
  const currentProject = useAppStore(s => s.currentProject)
  const activePageId = useAppStore(s => s.activePageId)
  const setActivePageId = useAppStore(s => s.setActivePageId)
  useAppStore(s => s.locale)
  const ui = useAppStore(s => s.config.ui)
  const includeMermaid = useAppStore(s => s.config.wiki.includeMermaid)
  const codeTheme = getCodeTheme(ui.codeTheme)
  const contentRef = useRef<HTMLDivElement>(null)
  const [showQuality, setShowQuality] = useState(false)
  const wikiPages = currentProject?.wikiPages || []

  const activePage = wikiPages.find(p => p.id === activePageId) || wikiPages[0]
  const currentIndex = wikiPages.findIndex(p => p.id === activePage?.id)
  const quality = useMemo(() => activePage ? validateWikiPage(activePage.content) : null, [activePage])

  useEffect(() => {
    if (wikiPages.length > 0 && !activePageId) {
      setActivePageId(wikiPages[0].id)
    }
  }, [wikiPages, activePageId, setActivePageId])

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0)
  }, [activePageId])

  if (wikiPages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-wiki-muted">
        <BookOpen size={48} className="mb-4 text-wiki-muted/30" />
        <h2 className="text-lg font-medium mb-2">{t('wikiNoneTitle')}</h2>
        <p className="text-sm text-wiki-muted/70 max-w-md text-center">
          {t('wikiNoneDescBefore')}<strong>{t('wikiGenerateBtnLabel')}</strong>{t('wikiNoneDescAfter')}
        </p>
      </div>
    )
  }

  if (!activePage) return null

  return (
    <div ref={contentRef} className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-wiki-text mb-3">{activePage.title}</h1>
          <div className="flex items-center gap-4 text-xs text-wiki-muted">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {new Date(activePage.lastUpdated).toLocaleDateString()}
            </span>
            {activePage.fileSources && activePage.fileSources.length > 0 && (
              <span className="flex items-center gap-1">
                <FileText size={12} />
                {activePage.fileSources.length} {t('wikiSourceFiles')}
              </span>
            )}
            {currentProject && <WikiExportButton project={currentProject} />}
            {quality && (
              <div className="relative">
                <button
                  onClick={() => setShowQuality(v => !v)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full border transition-colors ${
                    quality.grade === 'A' ? 'border-green-500/40 text-green-400' :
                    quality.grade === 'B' ? 'border-wiki-accent/40 text-wiki-accent' :
                    quality.grade === 'C' ? 'border-yellow-500/40 text-yellow-400' :
                    'border-red-500/40 text-red-400'
                  }`}
                  title={t('qualityCheckTitle')}
                >
                  <ShieldCheck size={12} />
                  {t('qualityLabel')} {quality.percent}% ({quality.grade})
                </button>
                {showQuality && (
                  <div className="absolute z-20 mt-2 w-72 right-0 bg-wiki-card border border-wiki-border rounded-lg shadow-xl p-3 text-left">
                    <div className="text-xs font-semibold text-wiki-text mb-2">{t('qualityStructureTitle')} — {quality.score}/{quality.maxScore}</div>
                    <div className="space-y-1.5">
                      {quality.checks.map(c => (
                        <div key={c.id} className="flex items-center justify-between text-xs">
                          <span className={c.pass ? 'text-wiki-text' : 'text-wiki-muted/60'}>{c.label}</span>
                          <span className={c.pass ? 'text-green-400' : 'text-red-400'}>{c.pass ? '✓' : '✗'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Wiki content */}
        <div className="wiki-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const lang = match?.[1]
                const content = String(children).replace(/\n$/, '')

                if (lang === 'mermaid' && includeMermaid) {
                  return <MermaidDiagram chart={content} />
                }

                if (lang) {
                  return (
                    <pre
                      className="rounded-lg border overflow-x-auto"
                      style={{ background: codeTheme.background, borderColor: codeTheme.border }}
                    >
                      <code
                        className={`${className || ''} ${wrapClass(ui.wordWrap)}`}
                        style={{ color: codeTheme.color }}
                        {...props}
                      >
                        {children}
                      </code>
                    </pre>
                  )
                }

                return <code className={className} {...props}>{children}</code>
              },
              pre({ children }) {
                return <>{children}</>
              },
            }}
          >
            {activePage.content}
          </ReactMarkdown>
        </div>

        {/* Page navigation */}
        <div className="mt-12 pt-6 border-t border-wiki-border flex items-center justify-between">
          {currentIndex > 0 ? (
            <button
              onClick={() => setActivePageId(wikiPages[currentIndex - 1].id)}
              className="flex items-center gap-2 text-sm text-wiki-muted hover:text-wiki-accent transition-colors"
            >
              <ChevronLeft size={16} />
              {wikiPages[currentIndex - 1].title}
            </button>
          ) : <div />}
          {currentIndex < wikiPages.length - 1 ? (
            <button
              onClick={() => setActivePageId(wikiPages[currentIndex + 1].id)}
              className="flex items-center gap-2 text-sm text-wiki-muted hover:text-wiki-accent transition-colors"
            >
              {wikiPages[currentIndex + 1].title}
              <ChevronRight size={16} />
            </button>
          ) : <div />}
        </div>
      </div>
    </div>
  )
}

// ── Wiki Export dropdown ─────────────────────────────────────────────────

function WikiExportButton({ project }: { project: import('../types').WikiProject }) {
  const [showMenu, setShowMenu] = useState(false)

  const handleExport = (format: ExportFormat) => {
    const result = exportWiki(project, format, { toc: true, metadata: true, graphStats: true })
    const blob = new Blob([result.content], { type: result.mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    a.click()
    URL.revokeObjectURL(url)
    setShowMenu(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(v => !v)}
        className="flex items-center gap-1 text-wiki-muted hover:text-wiki-accent transition-colors"
        title={t('wikiExport')}
      >
        <Download size={12} />
        <span>{t('wikiExport')}</span>
      </button>
      {showMenu && (
        <div className="absolute z-20 mt-2 w-40 right-0 bg-wiki-card border border-wiki-border rounded-lg shadow-xl overflow-hidden">
          {(['markdown', 'json', 'html'] as ExportFormat[]).map(fmt => (
            <button
              key={fmt}
              onClick={() => handleExport(fmt)}
              className="w-full px-3 py-2 text-left text-xs text-wiki-text hover:bg-wiki-accent/10 transition-colors"
            >
              {fmt === 'markdown' ? 'Markdown (.md)' : fmt === 'json' ? 'JSON (.json)' : 'HTML (.html)'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
