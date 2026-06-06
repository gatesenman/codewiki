import { useAppStore } from '../store'
import { Sidebar } from './Sidebar'
import { WikiViewer } from './WikiViewer'
import { KnowledgeGraph } from './KnowledgeGraph'
import { SearchPanel } from './SearchPanel'
import { ChatPanel } from './ChatPanel'
import { CodeAgentPanel } from './CodeAgentPanel'
import { InsightsPanel } from './InsightsPanel'
import { EntityDetailPanel } from './EntityDetailPanel'
import { TopBar } from './TopBar'

export function Layout() {
  const viewMode = useAppStore(s => s.viewMode)
  const sidebarCollapsed = useAppStore(s => s.sidebarCollapsed)
  const selectedEntityId = useAppStore(s => s.selectedEntityId)

  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden transition-all" key={viewMode}>
          <div className="h-full fade-in">
            {viewMode === 'wiki' && <WikiViewer />}
            {viewMode === 'graph' && <KnowledgeGraph />}
            {viewMode === 'search' && <SearchPanel />}
            {viewMode === 'chat' && <ChatPanel />}
            {viewMode === 'agent' && <CodeAgentPanel />}
            {viewMode === 'insights' && <InsightsPanel />}
          </div>
        </main>
        {selectedEntityId && <div className="slide-in-right"><EntityDetailPanel /></div>}
      </div>
    </div>
  )
}
