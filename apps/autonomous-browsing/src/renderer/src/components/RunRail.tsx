import type { ReactNode } from 'react'
import type { QueueSnapshot, RunSummary } from '../../../shared/types'
import { duration, relativeTime } from '../lib/format'
import { outcomeLabel, outcomeTone } from '../lib/outcome'
import { queueDepth, queueWaiting } from '../lib/queue-view'
import { stepMarks } from '../lib/run-model'
import { showQueueTab, type View } from '../lib/view'
import { useNow } from '../state/useNow'
import { SpineMini } from './Spine'
import { Dot, EmptyState } from './ui'
import shell from './app.module.css'
import styles from './runs.module.css'

interface RunRailProps {
  runs: RunSummary[]
  snapshot: QueueSnapshot
  view: View
  selectedId: string | null
  onSelect: (runId: string) => void
  onShowRun: () => void
  onShowQueue: () => void
  onShowHealth: () => void
  onShowSites: () => void
}

export function RunRail({
  runs,
  snapshot,
  view,
  selectedId,
  onSelect,
  onShowRun,
  onShowQueue,
  onShowHealth,
  onShowSites
}: RunRailProps): ReactNode {
  const live = runs.some((run) => run.endedAt === null) || countingDown(snapshot)
  const now = useNow(live ? 1000 : 20_000)
  const onRun = view.kind === 'run'
  const depth = queueDepth(snapshot)

  return (
    <nav className={shell.rail} aria-label="Runs">
      <div className={shell.railHeader}>
        <span className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${onRun ? styles.tabOn : ''}`}
            aria-pressed={onRun}
            onClick={onShowRun}
          >
            Runs
            {runs.length > 0 ? <span className={styles.tabCount}>{runs.length}</span> : null}
          </button>
          {showQueueTab(snapshot, view) ? (
            <button
              type="button"
              className={`${styles.tab} ${view.kind === 'queue' ? styles.tabOn : ''}`}
              aria-pressed={view.kind === 'queue'}
              onClick={onShowQueue}
            >
              Queued
              {depth > 0 ? <span className={styles.tabCount}>{depth}</span> : null}
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.tab} ${view.kind === 'health' ? styles.tabOn : ''}`}
            aria-pressed={view.kind === 'health'}
            onClick={onShowHealth}
          >
            Health
          </button>
          <button
            type="button"
            className={`${styles.tab} ${view.kind === 'sites' ? styles.tabOn : ''}`}
            aria-pressed={view.kind === 'sites'}
            onClick={onShowSites}
          >
            Site memory
          </button>
        </span>
      </div>
      <div className={shell.railBody}>
        {runs.length === 0 ? (
          <EmptyState title="No runs yet">
            Start an automation, or describe a goal, and every run is kept here.
          </EmptyState>
        ) : (
          <ul className={styles.list}>
            {runs.map((run) => {
              const current = run.id === selectedId && onRun
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    className={`${styles.row} ${current ? styles.selected : ''}`}
                    aria-current={current}
                    onClick={() => onSelect(run.id)}
                  >
                    <SpineMini marks={stepMarks(run)} />
                    <span className={styles.body}>
                      <span className={styles.title}>{run.routineName}</span>
                      <span className={styles.meta}>
                        <Dot tone={outcomeTone(run.status)} />
                        {outcomeLabel(run.status)}
                        <span className={styles.separator}>·</span>
                        {run.endedAt === null
                          ? duration(run.startedAt, null)
                          : relativeTime(run.endedAt, now)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </nav>
  )
}

function countingDown(snapshot: QueueSnapshot): boolean {
  return queueWaiting(snapshot).some((entry) => entry.announceUntil !== null)
}
