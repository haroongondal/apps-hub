import type { ReactNode } from 'react'
import type { RoutineHealth } from '../../../shared/types'
import { duration, plural } from '../lib/format'
import { EmptyState, Eyebrow } from './ui'
import shell from './app.module.css'
import styles from './health.module.css'

export function HealthView({ rows }: { rows: RoutineHealth[] }): ReactNode {
  return (
    <>
      <header className={styles.header}>
        <Eyebrow>Health</Eyebrow>
        <h2 className={styles.title}>How your automations are doing</h2>
        <p className={styles.lede}>
          One row per automation, across every run still kept. The bar is how often it finished without you.
        </p>
      </header>

      <div className={shell.detailBody}>
        {rows.length === 0 ? (
          <EmptyState title="Nothing to compare yet">
            Health needs runs to read. Start an automation and it will fill in.
          </EmptyState>
        ) : (
          <div className={styles.list}>
            {rows.map((row) => (
              <Row key={`${row.source}:${row.routineName}`} row={row} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Row({ row }: { row: RoutineHealth }): ReactNode {
  const other = row.runs - row.unattended - row.assisted - row.failed

  return (
    <article className={styles.row}>
      <div className={styles.name}>
        <span className={styles.nameText}>{row.routineName}</span>
        <span className={styles.kind}>{row.source === 'chat' ? 'Goal' : 'Automation'}</span>
      </div>

      <div className={styles.bar} aria-hidden="true">
        <Segment count={row.unattended} of={row.runs} tone="var(--ok)" />
        <Segment count={row.assisted} of={row.runs} tone="var(--human)" />
        <Segment count={row.failed} of={row.runs} tone="var(--fault)" />
        <Segment count={other} of={row.runs} tone="var(--line-strong)" />
      </div>

      <div className={styles.meta}>
        <span className={styles.figure}>{share(row.unattended, row.runs)}</span>
        without you
        <span className={styles.separator}>·</span>
        {plural(row.runs, 'run')}
        {row.assisted > 0 ? (
          <>
            <span className={styles.separator}>·</span>
            {row.assisted} needed you
          </>
        ) : null}
        {row.failed > 0 ? (
          <>
            <span className={styles.separator}>·</span>
            {row.failed} failed
          </>
        ) : null}
        {row.averageMs !== null ? (
          <>
            <span className={styles.separator}>·</span>
            {duration(0, row.averageMs)} typically
          </>
        ) : null}
        <span className={styles.separator}>·</span>
        {cost(row)}
        {row.worstStepIndex !== null ? (
          <>
            <span className={styles.separator}>·</span>
            <span className={styles.trouble}>
              step {row.worstStepIndex + 1} is the one that struggles ({row.worstStepTrouble}×)
            </span>
          </>
        ) : null}
      </div>
    </article>
  )
}

function Segment({ count, of, tone }: { count: number; of: number; tone: string }): ReactNode {
  if (count <= 0) return null
  return <span className={styles.segment} style={{ ['--tone' as string]: tone, flexGrow: count / of }} />
}

function share(part: number, whole: number): string {
  if (whole === 0) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

function cost(row: RoutineHealth): string {
  if (row.llmCalls === 0) return 'no model calls'
  const perRun = (row.llmCalls / row.runs).toFixed(1)
  return `${perRun} model calls a run`
}
