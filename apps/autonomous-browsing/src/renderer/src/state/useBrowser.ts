import { useCallback, useEffect, useState } from 'react'
import type { BrowserStatus } from '../../../shared/types'

export interface BrowserState {
  supported: boolean
  running: boolean
  working: boolean
  error: string | null
  open: () => void
  close: () => void
}

const INITIAL: BrowserStatus = { supported: false, running: false }

export function useBrowser(): BrowserState {
  const [status, setStatus] = useState<BrowserStatus>(INITIAL)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const refresh = (): void => void window.api.browser.status().then(setStatus, () => setStatus(INITIAL))
    const stopListening = window.api.browser.onChanged(setStatus)
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      stopListening()
    }
  }, [])

  const drive = useCallback((action: () => Promise<BrowserStatus>) => {
    setWorking(true)
    setError(null)
    action()
      .then(setStatus)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setWorking(false))
  }, [])

  return {
    supported: status.supported,
    running: status.running,
    working,
    error,
    open: useCallback(() => drive(window.api.browser.open), [drive]),
    close: useCallback(() => drive(window.api.browser.close), [drive])
  }
}
