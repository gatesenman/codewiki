/**
 * SymbolWikiView — wrapper that manages list ↔ detail navigation for Symbol Wiki.
 */

import { useState, useCallback } from 'react'
import { SymbolList, SymbolWiki } from './SymbolWiki'

export function SymbolWikiView() {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const handleSelect = useCallback((entityId: string) => {
    setHistory(prev => selectedEntityId ? [...prev, selectedEntityId] : prev)
    setSelectedEntityId(entityId)
  }, [selectedEntityId])

  const handleBack = useCallback(() => {
    const prev = history[history.length - 1]
    if (prev) {
      setHistory(h => h.slice(0, -1))
      setSelectedEntityId(prev)
    } else {
      setSelectedEntityId(null)
    }
  }, [history])

  if (selectedEntityId) {
    return (
      <SymbolWiki
        entityId={selectedEntityId}
        onBack={handleBack}
        onNavigate={handleSelect}
      />
    )
  }

  return <SymbolList onSelect={handleSelect} />
}
