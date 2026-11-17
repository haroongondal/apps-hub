import { useEffect, useState } from 'react'
import type { AutomationHoldEvent, ExtensionStatus } from '../../../shared/types'

export interface ExtensionState {
  connected: boolean
  paused: boolean
  holdReason: string | null
  holdAutomatic: boolean
}

const INITIAL: ExtensionState = { connected: false, paused: false, holdReason: null, holdAutomatic: false }

export function useExtension(): ExtensionState {
  const [state, setState] = useState<ExtensionState>(INITIAL)

  useEffect(() => {
    const applyStatus = (status: ExtensionStatus): void =>
      setState((current) => ({ ...current, connected: status.connected, paused: status.paused }))

    const applyHold = (hold: AutomationHoldEvent): void =>
      setState((current) => ({
        ...current,
        paused: hold.held,
        holdReason: hold.held ? hold.reason : null,
        holdAutomatic: hold.held && hold.automatic
      }))

    window.api.automation.status().then(applyStatus, () => setState(INITIAL))
    const offStatus = window.api.automation.onStatusChanged(applyStatus)
    const offHold = window.api.automation.onHold(applyHold)
    return () => {
      offStatus()
      offHold()
    }
  }, [])

  return state
}
