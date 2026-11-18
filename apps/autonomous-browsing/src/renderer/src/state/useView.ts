import { useCallback, useState } from 'react'
import { DEFAULT_VIEW, type View } from '../lib/view'

export interface ViewState {
  view: View
  showRun: () => void
  showQueue: () => void
  showRepairs: (routineId: string | null) => void
  showFiles: () => void
  showHealth: () => void
  showSites: () => void
}

export function useView(): ViewState {
  const [view, setView] = useState<View>(DEFAULT_VIEW)

  return {
    view,
    showRun: useCallback(() => setView({ kind: 'run' }), []),
    showQueue: useCallback(() => setView({ kind: 'queue' }), []),
    showRepairs: useCallback((routineId: string | null) => setView({ kind: 'repairs', routineId }), []),
    showFiles: useCallback(() => setView({ kind: 'files' }), []),
    showHealth: useCallback(() => setView({ kind: 'health' }), []),
    showSites: useCallback(() => setView({ kind: 'sites' }), [])
  }
}
