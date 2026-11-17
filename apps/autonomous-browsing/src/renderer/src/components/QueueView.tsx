import type { ReactNode } from 'react'
import type { QueueEntry, QueueSnapshot } from '../../../shared/types'
import { plural } from '../lib/format'
import { queueStateLabel, queueStateTone, queueWaiting, runningEntry, workLabel } from '../lib/queue-view'
import { useNow } from '../state/useNow'
import { Button, Dot, EmptyState, Eyebrow } from './ui'
import shell from './app.module.css'
import styles from './queue.module.css'

interface QueueViewProps {
  snapshot: QueueSnapshot
  names: Map<string, string>
  onCancel: (id: string) => void
  onClear: () => void
  onStop: () => void
}

export function QueueView({ snapshot, names, onCancel, onClear, onStop }: QueueViewProps): ReactNode {
  const running = runningEntry(snapshot)
  const waiting = queueWaiting(snapshot)
  const counting = waiting.some((entry) => entry.announceUntil !== null)
  const now = useNow(counting ? 1000 : 20_000)

  return (
    <>
      <header className={styles.header}>
        <Eyebrow>Queue</Eyebrow>
        <h2 className={styles.title}>What runs next</h2>
        <div className={styles.meta}>
          {running ? 'One running' : 'Nothing running'}
          <span className={styles.separator}>·</span>
          {waiting.length === 0 ? 'none waiting' : `${plural(waiting.length, 'waiting')}`}
          {snapshot.suspended ? (
            <>
              <span className={styles.separator}>·</span>
              <span className={styles.suspendedFlag}>suspended</span>
            </>
          ) : null}
        </div>
        {waiting.length > 0 ? (
          <div className={styles.headerActions}>
            <Button variant="quiet" size="sm" onClick={onClear}>
              Clear waiting
            </Button>
          </div>
        ) : null}
      </header>

      <div className={shell.detailBody}>
        <div className={styles.body}>
          {running ? (
            <Row
              entry={running}
              names={names}
              now={now}
              marker="now"
              action={
                <Button variant="quiet" size="sm" onClick={onStop}>
                  Stop run
                </Button>
              }
            />
          ) : null}

          {waiting.map((entry, at) => (
            <Row
              key={entry.id}
              entry={entry}
              names={names}
              now={now}
              marker={String(at + 1)}
              action={
                <Button variant="quiet" size="sm" onClick={() => onCancel(entry.id)}>
                  Cancel
                </Button>
              }
            />
          ))}

          {!running && waiting.length === 0 ? (
            <EmptyState title="Nothing queued">
              Runs you start while another is going wait here, in the order they were asked for.
            </EmptyState>
          ) : null}
        </div>
      </div>
    </>
  )
}

interface RowProps {
  entry: QueueEntry
  names: Map<string, string>
  now: number
  marker: string
  action: ReactNode
}

function Row({ entry, names, now, marker, action }: RowProps): ReactNode {
  const countingDown = entry.state === 'announcing' && entry.announceUntil !== null
  return (
    <article className={styles.row}>
      <span className={`${styles.marker} ${marker === 'now' ? styles.markerNow : ''}`} aria-hidden="true">
        {marker === 'now' ? '' : marker}
      </span>
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{workLabel(entry.work, names)}</span>
        <span className={styles.rowMeta}>
          <Dot tone={queueStateTone(entry.state)} />
          {countingDown && entry.announceUntil !== null
            ? `Starting in ${secondsLeft(entry.announceUntil, now)}s`
            : queueStateLabel(entry.state)}
        </span>
      </span>
      {action}
    </article>
  )
}

function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000))
}
