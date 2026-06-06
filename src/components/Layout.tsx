import { useAppStore } from '../store'
import { Sidebar } from './Sidebar'
import { WikiViewer } from './WikiViewer'
import { KnowledgeGraph } from './KnowledgeGraph'
import { SearchPanel } from './SearchPanel'
import { ChatPanel } from './ChatPanel'
import { CodeAgentPanel } from './CodeAgentPanel'
import { InsightsPanel } from './InsightsPanel'
import { CodeMap } from './CodeMap'
import { EntityDetailPanel } from './EntityDetailPanel'
import { TopBar } from './TopBar'
import { ErrorBoundary } from './ErrorBoundary'

export function Layout() {
  const viewMode = useAppStore(s => s.viewMode)
  const sidebarCollapsed = useAppStore(s => s.sidebarCollapsed)
  const selectedEntityId = useAppStore(s => s.selectedEntityId)
  const sidebarPosition = useAppStore(s => s.config.ui.sidebarPosition)

  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        {sidebarPosition === 'left' && <Sidebar />}
        <main className="flex-1 overflow-hidden transition-all" key={viewMode}>
          <ErrorBoundary>
            <div className="h-full fade-in">
              {viewMode === 'wiki' && <WikiViewer />}
              {viewMode === 'graph' && <KnowledgeGraph />}
              {viewMode === 'search' && <SearchPanel />}
              {viewMode === 'chat' && <ChatPanel />}
              {viewMode === 'agent' && <CodeAgentPanel />}
              {viewMode === 'insights' && <InsightsPanel />}
              {viewMode === 'codemap' && <CodeMap />}
            </div>
          </ErrorBoundary>
        </main>
        {selectedEntityId && <div className="slide-in-right"><EntityDetailPanel /></div>}
        {sidebarPosition === 'right' && <Sidebar />}
      </div>
    </div>
  )
}
