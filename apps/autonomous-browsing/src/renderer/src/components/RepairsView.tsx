import type { ReactNode } from 'react'
import { isLikeForLike, isStaleRepair } from '../../../shared/routines'
import type { RepairProposal, RoutineDefinition } from '../../../shared/types'
import { plural } from '../lib/format'
import { stepTarget } from '../lib/run-model'
import type { RepairsState } from '../state/useRepairs'
import { Button, EmptyState, Eyebrow } from './ui'
import shell from './app.module.css'
import styles from './repairs.module.css'

interface RepairsViewProps {
  repairs: RepairsState
  routineId: string | null
  names: Map<string, string>
  definitions: Map<string, RoutineDefinition>
  onOpenRun: (runId: string) => void
}

export function RepairsView({
  repairs,
  routineId,
  names,
  definitions,
  onOpenRun
}: RepairsViewProps): ReactNode {
  const shown = routineId
    ? repairs.proposals.filter((proposal) => proposal.routineId === routineId)
    : repairs.proposals
  const scope = routineId ? (names.get(routineId) ?? 'this automation') : 'all automations'

  return (
    <>
      <header className={styles.header}>
        <Eyebrow>Repairs</Eyebrow>
        <h2 className={styles.title}>Waiting for you to decide</h2>
        <div className={styles.meta}>
          {scope}
          <span className={styles.separator}>·</span>
          {shown.length === 0 ? 'nothing pending' : plural(shown.length, 'proposal')}
        </div>
      </header>

      <div className={shell.detailBody}>
        <div className={styles.body}>
          {repairs.error ? (
            <div className={styles.problem} role="alert">
              <p>{repairs.error}</p>
              <Button variant="quiet" size="sm" onClick={repairs.dismissError}>
                Dismiss
              </Button>
            </div>
          ) : null}

          {shown.length === 0 ? (
            <EmptyState title="Nothing to review">
              When a run repairs a step, the fix is used for that run only. It waits here until you decide
              whether the automation should keep it.
            </EmptyState>
          ) : (
            shown.map((proposal) => (
              <Proposal
                key={proposal.id}
                proposal={proposal}
                name={names.get(proposal.routineId) ?? proposal.routineId}
                definition={definitions.get(proposal.routineId)}
                repairs={repairs}
                onOpenRun={onOpenRun}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}

interface ProposalProps {
  proposal: RepairProposal
  name: string
  definition: RoutineDefinition | undefined
  repairs: RepairsState
  onOpenRun: (runId: string) => void
}

function Proposal({ proposal, name, definition, repairs, onOpenRun }: ProposalProps): ReactNode {
  const repair = {
    stepIndex: proposal.stepIndex,
    reason: proposal.reason,
    original: proposal.original,
    replacement: proposal.replacement
  }
  const stale = definition ? isStaleRepair(repair, definition) : false
  const writable = isLikeForLike(repair) && !stale
  const busy = repairs.deciding !== null

  return (
    <article className={styles.proposal}>
      <div className={styles.proposalHead}>
        <span className={styles.routine}>{name}</span>
        <span className={styles.step}>step {proposal.stepIndex + 1}</span>
      </div>
      <p className={styles.reason}>{proposal.reason}</p>

      <div className={styles.swap}>
        <span className={styles.was}>
          <span className={styles.swapKind}>{proposal.original.kind}</span>
          {stepTarget(proposal.original)}
        </span>
        {proposal.replacement.map((step, at) => (
          <span key={at} className={styles.now}>
            <span className={styles.swapKind}>{step.kind}</span>
            {stepTarget(step)}
          </span>
        ))}
      </div>

      <p className={styles.frame}>
        {proposal.screenshotPath ? 'The page as it was when the step failed is on record.' : 'No screenshot captured.'}
      </p>

      {stale ? (
        <p className={styles.stale}>
          This automation has changed since the repair, so the step it fixed is no longer there. Keeping
          it would overwrite the newer version.
        </p>
      ) : null}

      <div className={styles.actions}>
        {writable ? (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void repairs.accept(proposal.id)}>
            Keep this change
          </Button>
        ) : stale ? null : (
          <span className={styles.note}>
            This repair took {plural(proposal.replacement.length, 'step')}, so it worked around something that
            will not recur. Edit the automation if it should change for good.
          </span>
        )}
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void repairs.acceptOnce(proposal.id)}>
          Just that once
        </Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => void repairs.reject(proposal.id)}>
          Reject
        </Button>
        <span className={styles.grow} />
        {proposal.runId ? (
          <Button variant="quiet" size="sm" onClick={() => onOpenRun(proposal.runId as string)}>
            See the run
          </Button>
        ) : (
          <span className={styles.note}>That run has since been cleared.</span>
        )}
      </div>
    </article>
  )
}
