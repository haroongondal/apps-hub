import { useCallback, useEffect, useState } from 'react'
import type { RepairProposal } from '../../../shared/types'

export interface RepairsState {
  proposals: RepairProposal[]
  pendingByRoutine: Map<string, number>
  deciding: number | null
  accept: (proposalId: number) => Promise<void>
  acceptOnce: (proposalId: number) => Promise<void>
  reject: (proposalId: number) => Promise<void>
  error: string | null
  dismissError: () => void
}

export function useRepairs(): RepairsState {
  const [proposals, setProposals] = useState<RepairProposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<number | null>(null)

  const refresh = useCallback((): void => {
    window.api.repairs.list().then(setProposals, () => setProposals([]))
  }, [])

  useEffect(() => {
    refresh()
    return window.api.repairs.onChanged(refresh)
  }, [refresh])

  const decide = useCallback(
    async (id: number, act: () => Promise<unknown>): Promise<void> => {
      setError(null)
      setDeciding(id)
      try {
        await act()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
      setDeciding(null)
      refresh()
    },
    [refresh]
  )

  const pendingByRoutine = new Map<string, number>()
  for (const proposal of proposals) {
    pendingByRoutine.set(proposal.routineId, (pendingByRoutine.get(proposal.routineId) ?? 0) + 1)
  }

  return {
    proposals,
    pendingByRoutine,
    deciding,
    accept: useCallback((id: number) => decide(id, () => window.api.repairs.accept(id)), [decide]),
    acceptOnce: useCallback((id: number) => decide(id, () => window.api.repairs.acceptOnce(id)), [decide]),
    reject: useCallback((id: number) => decide(id, () => window.api.repairs.reject(id)), [decide]),
    error,
    dismissError: useCallback(() => setError(null), [])
  }
}
