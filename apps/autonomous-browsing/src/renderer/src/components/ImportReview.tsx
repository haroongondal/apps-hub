import type { ReactNode } from 'react'
import type { Destination, RoutineReview } from '../../../shared/routine-review'
import type { RoutineFile } from '../../../shared/types'
import { plural } from '../lib/format'
import { Button, Eyebrow } from './ui'
import shell from './app.module.css'
import styles from './files.module.css'

export interface Pending {
  file: RoutineFile
  review: RoutineReview
  path: string
}

interface ImportReviewProps {
  pending: Pending
  problem: string | null
  saving: boolean
  onConfirm: (overwrite: boolean) => void
  onCancel: () => void
}

export function ImportReview({
  pending,
  problem,
  saving,
  onConfirm,
  onCancel
}: ImportReviewProps): ReactNode {
  const { review } = pending
  const clash = problem !== null && problem.includes('already exists')

  return (
    <>
      <header className={styles.header}>
        <Eyebrow>Import</Eyebrow>
        <h2 className={styles.title}>{review.name}</h2>
        <div className={styles.meta}>
          {plural(review.stepCount, 'step')}
          <span className={styles.separator}>·</span>
          {pending.path}
        </div>
      </header>

      <div className={shell.detailBody}>
        <div className={styles.body}>
          {review.description ? <p className={styles.description}>{review.description}</p> : null}

          <Section title="Where it goes">
            {review.destinations.length === 0 ? (
              <p className={styles.plain}>It never navigates on its own.</p>
            ) : (
              <ul className={styles.list}>
                {review.destinations.map((destination, at) => (
                  <li key={at} className={styles.row}>
                    {describeDestination(destination)}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {review.requiredParams.length > 0 ? (
            <Section title="You will have to supply">
              <ul className={styles.list}>
                {review.requiredParams.map((name) => (
                  <li key={name} className={styles.row}>
                    {name}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="What it might commit">
            {review.commits.length === 0 ? (
              <p className={styles.plain}>Nothing in the file says it buys, sends or confirms anything.</p>
            ) : (
              <ul className={styles.list}>
                {review.commits.map((flag) => (
                  <li key={flag.stepIndex} className={styles.row}>
                    <span className={flag.signal === 'certain' ? styles.certain : styles.suspected}>
                      Step {flag.stepIndex + 1}
                    </span>
                    {flag.why}
                  </li>
                ))}
              </ul>
            )}
            {review.opaqueClicks > 0 ? (
              <p className={styles.caveat}>
                {plural(review.opaqueClicks, 'click')} cannot be judged from the file at all — a selector
                like <code>#btn-1</code> could be "next page" or "place order", and only running it tells
                you which. Import this only from someone you trust.
              </p>
            ) : null}
          </Section>

          {problem ? (
            <div className={styles.problem} role="alert">
              <p>{problem}</p>
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button variant="primary" onClick={() => onConfirm(clash)} disabled={saving}>
              {clash ? 'Replace the existing one' : 'Add this automation'}
            </Button>
            <Button variant="quiet" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className={styles.section}>
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  )
}

function describeDestination(destination: Destination): string {
  if (destination.kind === 'literal') return destination.origin
  if (destination.kind === 'runtime') {
    return `supplied when it runs — ${destination.params.join(', ')}`
  }
  return `${destination.prefix}… — the rest supplied when it runs (${destination.params.join(', ')})`
}
