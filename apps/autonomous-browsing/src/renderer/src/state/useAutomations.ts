import { useCallback, useEffect, useState } from 'react'
import type { SystemRoutine, UserRoutine } from '../../../shared/types'

export interface AutomationsState {
  builtIn: SystemRoutine[]
  yours: UserRoutine[]
  syncErrors: string[]
  loaded: boolean
  reload: () => void
  refresh: () => Promise<void>
}

export function useAutomations(): AutomationsState {
  const [builtIn, setBuiltIn] = useState<SystemRoutine[]>([])
  const [yours, setYours] = useState<UserRoutine[]>([])
  const [syncErrors, setSyncErrors] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const [system, user, sync] = await Promise.all([
      window.api.system.list(),
      window.api.user.list(),
      window.api.system.lastSync()
    ])
    setBuiltIn(system)
    setYours(user)
    setSyncErrors(sync?.errors ?? [])
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    return window.api.onRoutinesChanged(() => void refresh())
  }, [refresh])

  const reload = useCallback(() => {
    void window.api.system.reload()
  }, [])

  return { builtIn, yours, syncErrors, loaded, reload, refresh }
}
