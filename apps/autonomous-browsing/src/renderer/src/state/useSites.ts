import { useCallback, useEffect, useState } from 'react'
import type { SiteOriginSummary } from '../../../shared/types'
import type { SiteLandmark } from '../../../shared/site-memory'

export interface SitesState {
  origins: SiteOriginSummary[]
  landmarks: Map<string, SiteLandmark[]>
  open: (origin: string) => void
  forget: (origin: string) => Promise<void>
  purge: () => Promise<void>
}

export function useSites(): SitesState {
  const [origins, setOrigins] = useState<SiteOriginSummary[]>([])
  const [landmarks, setLandmarks] = useState<Map<string, SiteLandmark[]>>(new Map())

  const refresh = useCallback((): void => {
    window.api.sites.list().then(setOrigins, () => setOrigins([]))
    setLandmarks(new Map())
  }, [])

  useEffect(() => {
    refresh()
    const stopSites = window.api.sites.onChanged(refresh)
    const stopRuns = window.api.runs.onChanged(refresh)
    return () => {
      stopSites()
      stopRuns()
    }
  }, [refresh])

  const open = useCallback((origin: string): void => {
    window.api.sites.landmarks(origin).then(
      (rows) => setLandmarks((prior) => new Map(prior).set(origin, rows)),
      () => undefined
    )
  }, [])

  return {
    origins,
    landmarks,
    open,
    forget: useCallback(
      async (origin: string) => {
        await window.api.sites.forget(origin)
        refresh()
      },
      [refresh]
    ),
    purge: useCallback(async () => {
      await window.api.sites.purge()
      refresh()
    }, [refresh])
  }
}
