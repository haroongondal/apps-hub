import { useEffect, useState, type ReactNode } from 'react'
import { MAX_REPAIRS_PER_RUN, type ResumePlan, type ResumeRefusal } from '../../../shared/resume'
import { requiredParams } from '../../../shared/routines'
import type {
  RoutineDefinition,
  RunArtifactRecord,
  RunDetail,
  RunRepairRecord,
  RunStepRecord
} from '../../../shared/types'
import { clockTime, duration, plural } from '../lib/format'
import { humanStepNote, outcomeLabel, outcomeTone } from '../lib/outcome'
import {
  closingNote,
  extractedValues,
  screenshotsByStep,
  repairsByStep,
  stepTarget,
  threadRows
} from '../lib/run-model'
import { costLine, stepNote, timeSplit } from '../lib/telemetry-view'
import { useNow } from '../state/useNow'
import { SpineSlice } from './Spine'
import { Button, Dot, Eyebrow, Field } from './ui'
import shell from './app.module.css'
import styles from './thread.module.css'

interface ThreadViewProps {
  run: RunDetail
  plannedSteps: string[]
  definition: RoutineDefinition | null
  warnAboutTab: boolean
  onSave: (runId: string, name: string) => Promise<void>
  onDelete: (runId: string) => void
  onRerun: (runId: string, params: Record<string, string>) => void
  onResume: (runId: string, startIndex: number) => void
}

export function ThreadView({
  run,
  plannedSteps,
  definition,
  warnAboutTab,
  onSave,
  onDelete,
  onRerun,
  onResume
}: ThreadViewProps): ReactNode {
  useNow(run.endedAt === null ? 1000 : 60_000)
  const rows = threadRows(run, plannedSteps)
  const repairs = repairsByStep(run)
  const shots = screenshotsByStep(run)
  const extracted = extractedValues(run)
  const params = Object.entries(run.params)
  const closing = closingNote(run)
  const measured = new Map(run.steps.map((step) => [step.stepIndex, step]))
  const spent = timeSplit(run.steps)

  return (
    <>
      <header className={styles.header}>
        <Eyebrow>{run.source === 'chat' ? 'Goal' : 'Automation'}</Eyebrow>
        <h2 className={styles.title}>{run.routineName}</h2>
        <div className={styles.meta}>
          <Dot tone={outcomeTone(run.status)} />
          {outcomeLabel(run.status)}
          {humanStepNote(run.humanSteps) ? (
            <>
              <span className={styles.separator}>·</span>
              {humanStepNote(run.humanSteps)}
            </>
          ) : null}
          <span className={styles.separator}>·</span>
          {plural(rows.length, 'step')}
          <span className={styles.separator}>·</span>
          {duration(run.startedAt, run.endedAt)}
          <span className={styles.separator}>·</span>
          started {clockTime(run.startedAt)}
        </div>
        <div className={styles.meta}>
          {costLine(run.usage)}
          {spent ? (
            <>
              <span className={styles.separator}>·</span>
              {spent}
            </>
          ) : null}
        </div>
        {params.length > 0 ? (
          <div className={styles.given}>
            {params.map(([key, value]) => (
              <span key={key} className={styles.givenPair}>
                <span className={styles.givenKey}>{key}</span>
                {value || '(left empty)'}
              </span>
            ))}
          </div>
        ) : null}
        <div className={styles.headerActions}>
          <SaveAction run={run} onSave={onSave} />
          <RerunAction key={`rerun-${run.id}`} run={run} definition={definition} onRerun={onRerun} />
          <ResumeAction key={`resume-${run.id}`} run={run} warnAboutTab={warnAboutTab} onResume={onResume} />
          {run.endedAt !== null ? <DeleteAction runId={run.id} onDelete={onDelete} /> : null}
        </div>
      </header>

      <div className={shell.detailBody}>
        <div className={styles.body}>
          <div className={styles.steps}>
            {rows.map((row, position) => (
              <div key={row.index} className={styles.step}>
                <SpineSlice mark={row.mark} first={position === 0} last={position === rows.length - 1} />
                <span className={styles.index}>{row.index + 1}</span>
                <div className={styles.stepBody}>
                  <p className={`${styles.stepText} ${row.mark === 'pending' ? styles.pending : ''}`}>
                    {row.description}
                  </p>
                  {repairs.has(row.index)
                    ? null
                    : row.notes.map((note) => (
                        <p key={note} className={styles.note}>
                          {note}
                        </p>
                      ))}
                  {measuredNote(measured.get(row.index))}
                  {(repairs.get(row.index) ?? []).map((repair, at) => (
                    <RepairCallout key={at} repair={repair} />
                  ))}
                  {(shots.get(row.index) ?? []).map((artifact) => (
                    <Screenshot key={artifact.id} artifact={artifact} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {closing ? (
            <section className={styles.section}>
              <Eyebrow>How it ended</Eyebrow>
              <p className={styles.closing}>{closing}</p>
            </section>
          ) : null}

          {extracted.length > 0 ? <Table title="What it read" rows={extracted} emptyValue="(empty)" /> : null}

          {run.error ? (
            <div className={styles.failure}>
              <span className={styles.failureTitle}>
                {failureTitle(run)}
                {run.failedStepIndex !== null ? ` at step ${run.failedStepIndex + 1}` : ''}
              </span>
              <span className={styles.failureDetail}>{run.error}</span>
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

function DeleteAction({
  runId,
  onDelete
}: {
  runId: string
  onDelete: (runId: string) => void
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button variant="quiet" size="sm" onClick={() => setConfirming(true)}>
        Delete run
      </Button>
    )
  }
  return (
    <>
      <span className={styles.hint}>Delete this run and its screenshots?</span>
      <Button variant="danger" size="sm" onClick={() => onDelete(runId)}>
        Delete
      </Button>
      <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </>
  )
}

function failureTitle(run: RunDetail): string {
  if (run.status === 'cancelled') return 'You stopped this run'
  if (run.status === 'interrupted') return 'The app closed during this run'
  return 'This run failed'
}

function Table({
  title,
  rows,
  emptyValue
}: {
  title: string
  rows: [string, string][]
  emptyValue: string
}): ReactNode {
  return (
    <section className={styles.section}>
      <Eyebrow>{title}</Eyebrow>
      <div className={styles.extracted}>
        {rows.map(([key, value]) => (
          <div key={key} className={styles.extractedRow}>
            <span className={styles.extractedKey}>{key}</span>
            <span className={styles.extractedValue}>{value || emptyValue}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SaveAction({
  run,
  onSave
}: {
  run: RunDetail
  onSave: (runId: string, name: string) => Promise<void>
}): ReactNode {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const recorded = run.recordedSteps?.length ?? 0

  if (run.source !== 'chat') return null
  if (!naming) {
    return (
      <>
        <Button variant="secondary" size="sm" onClick={() => setNaming(true)} disabled={recorded === 0}>
          Save as an automation
        </Button>
        {recorded === 0 ? <span className={styles.hint}>Nothing recorded to save yet.</span> : null}
      </>
    )
  }

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(run.id, trimmed).then(() => setNaming(false), (error: Error) => setProblem(error.message))
  }

  return (
    <div className={styles.saveRow}>
      <input
        className={styles.saveInput}
        value={name}
        autoFocus
        placeholder={`Name this automation (${plural(recorded, 'step')})`}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && submit()}
      />
      <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim()}>
        Save
      </Button>
      <Button variant="quiet" size="sm" onClick={() => setNaming(false)}>
        Cancel
      </Button>
      {problem ? <p className={styles.actionError}>{problem}</p> : null}
    </div>
  )
}

function RerunAction({
  run,
  definition,
  onRerun
}: {
  run: RunDetail
  definition: RoutineDefinition | null
  onRerun: (runId: string, params: Record<string, string>) => void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [params, setParams] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<string[]>([])

  const rerunnable = run.source === 'routine' && run.routineId !== null && run.endedAt !== null
  if (!rerunnable || !definition) return null

  if (!editing) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setParams(rerunParams(definition, run.params))
          setMissing([])
          setEditing(true)
        }}
      >
        Run this again
      </Button>
    )
  }

  const confirm = (): void => {
    const blank = requiredParams(definition, params)
    setMissing(blank)
    if (blank.length > 0) return
    onRerun(run.id, params)
    setEditing(false)
  }

  const problem =
    missing.length === 0
      ? null
      : `Fill in ${missing.map((name) => paramLabel(definition, name)).join(', ')} before running this again.`

  return (
    <div className={styles.actionPanel}>
      {Object.entries(definition.params ?? {}).map(([name, spec]) => (
        <Field
          key={name}
          label={spec.description ?? name}
          required={spec.required}
          invalid={missing.includes(name)}
          value={params[name] ?? ''}
          onChange={(value) => {
            setMissing((current) => current.filter((missed) => missed !== name))
            setParams((current) => ({ ...current, [name]: value }))
          }}
        />
      ))}
      <div className={styles.saveRow}>
        <Button variant="primary" size="sm" onClick={confirm}>
          Run it again
        </Button>
        <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {problem ? <p className={styles.actionError}>{problem}</p> : null}
    </div>
  )
}

function ResumeAction({
  run,
  warnAboutTab,
  onResume
}: {
  run: RunDetail
  warnAboutTab: boolean
  onResume: (runId: string, startIndex: number) => void
}): ReactNode {
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<ResumePlan | ResumeRefusal | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const resumable =
    (run.status === 'error' || run.status === 'interrupted') && run.source === 'routine' && run.routineId !== null
  if (!resumable) return null

  const ask = (startIndex?: number): void => {
    setAsking(true)
    setAnswer(null)
    setProblem(null)
    window.api.runs.resumePlan(run.id, startIndex).then(setAnswer, (error: Error) => setProblem(error.message))
  }

  if (!asking) {
    return (
      <Button variant="secondary" size="sm" onClick={() => ask()}>
        Resume from where it stopped
      </Button>
    )
  }

  return (
    <div className={styles.actionPanel}>
      {problem ? <p className={styles.actionError}>{problem}</p> : null}
      {answer === null && problem === null ? (
        <p className={styles.hint}>Working out where this could start again…</p>
      ) : null}
      {answer !== null && !answer.ok ? <ResumeRefused refusal={answer} onChoose={ask} /> : null}
      {answer?.ok ? <ResumePlanNote plan={answer} warnAboutTab={warnAboutTab} /> : null}
      <div className={styles.saveRow}>
        {answer?.ok ? (
          <Button variant="primary" size="sm" onClick={() => onResume(run.id, answer.startIndex)}>
            Resume
          </Button>
        ) : null}
        <Button variant="quiet" size="sm" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ResumeRefused({
  refusal,
  onChoose
}: {
  refusal: ResumeRefusal
  onChoose: (startIndex: number) => void
}): ReactNode {
  return (
    <>
      <p className={styles.planWarning}>{refusal.message}</p>
      {refusal.choices ? (
        <div className={styles.saveRow}>
          {refusal.choices.map((choice) => (
            <Button key={choice.startIndex} variant="secondary" size="sm" onClick={() => onChoose(choice.startIndex)}>
              {choice.label}
            </Button>
          ))}
        </div>
      ) : null}
    </>
  )
}

function ResumePlanNote({ plan, warnAboutTab }: { plan: ResumePlan; warnAboutTab: boolean }): ReactNode {
  return (
    <>
      <p className={styles.planLine}>Starts at step {plan.startIndex + 1}.</p>
      <p className={styles.hint}>
        Skips {plural(plan.skipped.length, 'step')} and replays {plural(plan.replayedNavigates.length, 'navigation')}.
      </p>
      {plan.driftExplained ? (
        <p className={styles.hint}>
          This automation has changed since that run, but only where your automation already learned this from that
          run&apos;s own repairs.
        </p>
      ) : null}
      {plan.submitFlags.length > 0 ? <p className={styles.planWarning}>{submitWarning(plan.submitFlags)}</p> : null}
      <p className={styles.hint}>
        {plan.repairBudget} of {MAX_REPAIRS_PER_RUN} repairs left.
      </p>
      {plan.repairBudget === 0 ? (
        <p className={styles.planWarning}>
          No repairs left — a person will be asked to do each failing step by hand.
        </p>
      ) : null}
      <p className={styles.hint}>
        This assumes the browser is still signed in where the run stopped. Nothing checks that.
      </p>
      {warnAboutTab ? (
        <p className={styles.planWarning}>
          Focus the tab you want automated before confirming — the run drives whichever tab is active.
        </p>
      ) : null}
    </>
  )
}

function submitWarning(submitFlags: number[]): string {
  const numbers = submitFlags.map((index) => index + 1).join(', ')
  if (submitFlags.length === 1) return `Step ${numbers} submits a form.`
  return `Steps ${numbers} submit a form.`
}

function paramLabel(definition: RoutineDefinition, name: string): string {
  return definition.params?.[name]?.description ?? name
}

function rerunParams(definition: RoutineDefinition, was: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [name, spec] of Object.entries(definition.params ?? {})) values[name] = was[name] ?? spec.default ?? ''
  return values
}

function RepairCallout({ repair }: { repair: RunRepairRecord }): ReactNode {
  return (
    <div className={styles.repair}>
      <span className={styles.repairReason}>Repaired: {repair.reason}</span>
      <div className={styles.swap}>
        <span className={styles.was}>
          <span className={styles.swapKind}>{repair.original.kind}</span>
          {stepTarget(repair.original)}
        </span>
        {repair.replacement.map((step, at) => (
          <span key={at} className={styles.now}>
            <span className={styles.swapKind}>{step.kind}</span>
            {stepTarget(step)}
          </span>
        ))}
      </div>
    </div>
  )
}

function Screenshot({ artifact }: { artifact: RunArtifactRecord }): ReactNode {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!artifact.hasImage) return
    let live = true
    window.api.runs.artifact(artifact.id).then((url) => {
      if (live) setDataUrl(url)
    })
    return () => {
      live = false
    }
  }, [artifact.id, artifact.hasImage])

  if (!artifact.hasImage) {
    return (
      <p className={styles.noShot}>
        No screenshot from here on — {artifact.text ?? 'no frame was captured'}.
      </p>
    )
  }

  return (
    <figure className={styles.shot}>
      {dataUrl ? <img src={dataUrl} alt={`Screenshot: ${artifact.label}`} /> : <span className={styles.shotPending} />}
      <figcaption>{artifact.label}</figcaption>
    </figure>
  )
}

export function ThreadBlank({ connected }: { connected: boolean }): ReactNode {
  return (
    <div className={styles.blank}>
      <p className={styles.blankTitle}>{connected ? 'Nothing running' : 'Chrome is not connected'}</p>
      <p className={styles.blankHint}>
        {connected
          ? 'Run an automation from the left, or describe a goal below. Every run appears here step by step.'
          : 'Open Chrome and check the companion extension is enabled. Automations drive the tab you are looking at.'}
      </p>
    </div>
  )
}

function measuredNote(step: RunStepRecord | undefined): ReactNode {
  const note = step ? stepNote(step) : null
  return note ? <p className={styles.note}>{note}</p> : null
}
