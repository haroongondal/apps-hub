import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { describeStep } from '../../shared/routines'
import { AutomationRail } from './components/AutomationRail'
import { GoalComposer } from './components/GoalComposer'
import { QueueNotices } from './components/QueueNotices'
import { ExportReview } from './components/ExportReview'
import { HealthView } from './components/HealthView'
import { ImportReview } from './components/ImportReview'
import { QueueView } from './components/QueueView'
import { RepairsView } from './components/RepairsView'
import { RunRail } from './components/RunRail'
import { SitesView } from './components/SitesView'
import { ThreadBlank, ThreadView } from './components/ThreadView'
import { HoldBanner, TopBar } from './components/TopBar'
import { Button, EmptyState } from './components/ui'
import type { RoutineDefinition, RoutineHealth, RunDetail } from '../../shared/types'
import type { View } from './lib/view'
import { controlState, queueRunning, queuedBehindHint } from './lib/queue-view'
import { useAutomations } from './state/useAutomations'
import { useBrowser } from './state/useBrowser'
import { useExtension } from './state/useExtension'
import { useQueue, type QueueState } from './state/useQueue'
import { useFiles, type FilesState } from './state/useFiles'
import { useHealth } from './state/useHealth'
import { useRepairs, type RepairsState } from './state/useRepairs'
import { useRuns } from './state/useRuns'
import { useSites, type SitesState } from './state/useSites'
import { useView } from './state/useView'
import shell from './components/app.module.css'
import topbar from './components/topbar.module.css'

export function App(): ReactNode {
  const extension = useExtension()
  const browser = useBrowser()
  const automations = useAutomations()
  const queue = useQueue()
  const { view, showRun, showQueue, showRepairs, showFiles, showHealth, showSites } = useView()
  const repairs = useRepairs()
  const sites = useSites()
  const files = useFiles(showRun)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const follow = useCallback(() => !queueRunning(queue.snapshot), [queue.snapshot])
  const runs = useRuns({ follow })
  const health = useHealth()
  const controls = controlState(queue.snapshot)
  const plannedSteps = usePlannedSteps(automations, runs.selected)
  const names = useAutomationNames(automations)
  const definitions = useAutomationDefinitions(automations)
  const runDefinition = useRunDefinition(automations, runs.selected)

  return (
    <div className={shell.app}>
      <TopBar
        extension={extension}
        browser={browser}
        running={controls.showStop}
        onPause={() => void window.api.automation.pause()}
        onStop={() => void runs.requestCancel()}
      />

      <div>
        <HoldBanner
          extension={extension}
          onResume={() => void window.api.automation.resume()}
          onStop={() => void runs.requestCancel()}
        />
        {runs.startError ? (
          <div className={topbar.notice} role="alert">
            <p className={topbar.noticeText}>
              <span className={topbar.noticeTitle}>Did not start</span>
              {runs.startError}
            </p>
            <Button variant="quiet" size="sm" onClick={runs.dismissStartError}>
              Dismiss
            </Button>
          </div>
        ) : null}
        <QueueNotices snapshot={queue.snapshot} names={names} onStart={queue.start} />
      </div>

      <div className={shell.workspace}>
        <AutomationRail
          automations={automations}
          canRun={controls.canStart}
          pendingRepairs={repairs.pendingByRoutine}
          onReview={showRepairs}
          onExport={(kind, id) => {
            showFiles()
            void files.beginExport(kind, id)
          }}
          onImport={() => {
            showFiles()
            void files.beginImport()
          }}
          onRun={(input) => void runs.startRoutine(input)}
          onNewGoal={() => {
            showRun()
            runs.select(null)
            composerInput.current?.focus()
          }}
        />
        <RunRail
          runs={runs.summaries}
          snapshot={queue.snapshot}
          view={view}
          selectedId={runs.selected?.id ?? null}
          onSelect={(runId) => {
            showRun()
            runs.select(runId)
          }}
          onShowRun={showRun}
          onShowQueue={showQueue}
          onShowHealth={showHealth}
          onShowSites={showSites}
        />
        <section className={shell.detail} aria-label={paneLabel(view)}>
          <DetailPane
            view={view}
            health={health}
            queue={queue}
            repairs={repairs}
            sites={sites}
            files={files}
            names={names}
            definitions={definitions}
            onOpenRun={(runId) => {
              showRun()
              runs.select(runId)
            }}
            connected={extension.connected}
            run={runs.selected}
            plannedSteps={plannedSteps}
            runDefinition={runDefinition}
            warnAboutTab={!browser.supported}
            onSave={runs.saveAsAutomation}
            onDelete={(runId) => void runs.remove(runId)}
            onRerun={(runId, params) => void runs.rerun(runId, params)}
            onResume={(runId, startIndex) => void runs.resumeRun(runId, startIndex)}
            onStop={() => void runs.requestCancel()}
          />
          <GoalComposer
            canSend={controls.canStart}
            connected={extension.connected}
            queuedBehind={queuedBehindHint(queue.snapshot)}
            onSend={(goal) => void runs.startGoal(goal)}
            inputRef={composerInput}
          />
        </section>
      </div>
    </div>
  )
}

function paneLabel(view: View): string {
  if (view.kind === 'queue') return 'Queue'
  if (view.kind === 'repairs') return 'Repairs'
  if (view.kind === 'files') return 'Import and export'
  if (view.kind === 'health') return 'Health'
  if (view.kind === 'sites') return 'Site memory'
  return 'Run detail'
}

function FilesBlank({ problem, savedTo }: { problem: string | null; savedTo: string | null }): ReactNode {
  if (problem) {
    return (
      <div className={topbar.notice} role="alert">
        <p className={topbar.noticeText}>
          <span className={topbar.noticeTitle}>That file could not be used</span>
          {problem}
        </p>
      </div>
    )
  }
  return (
    <EmptyState title={savedTo ? 'Saved' : 'Nothing to show'}>
      {savedTo ?? 'Pick an automation to export, or import one from a file.'}
    </EmptyState>
  )
}

interface DetailPaneProps {
  view: View
  health: RoutineHealth[]
  queue: QueueState
  repairs: RepairsState
  sites: SitesState
  files: FilesState
  names: Map<string, string>
  definitions: Map<string, RoutineDefinition>
  onOpenRun: (runId: string) => void
  connected: boolean
  run: RunDetail | null
  plannedSteps: string[]
  runDefinition: RoutineDefinition | null
  warnAboutTab: boolean
  onSave: (runId: string, name: string) => Promise<void>
  onDelete: (runId: string) => void
  onRerun: (runId: string, params: Record<string, string>) => void
  onResume: (runId: string, startIndex: number) => void
  onStop: () => void
}

function DetailPane({
  view,
  health,
  queue,
  repairs,
  sites,
  files,
  names,
  definitions,
  onOpenRun,
  connected,
  run,
  plannedSteps,
  runDefinition,
  warnAboutTab,
  onSave,
  onDelete,
  onRerun,
  onResume,
  onStop
}: DetailPaneProps): ReactNode {
  if (view.kind === 'health') {
    return <HealthView rows={health} />
  }
  if (view.kind === 'sites') {
    return <SitesView state={sites} />
  }
  if (view.kind === 'queue') {
    return (
      <QueueView
        snapshot={queue.snapshot}
        names={names}
        onCancel={queue.cancel}
        onClear={queue.clear}
        onStop={onStop}
      />
    )
  }
  if (view.kind === 'files') {
    if (files.outgoing) {
      return (
        <ExportReview
          outgoing={files.outgoing}
          problem={files.problem}
          writing={files.busy}
          onWrite={(file) => void files.write(file)}
          onCancel={files.clear}
        />
      )
    }
    if (files.pending) {
      return (
        <ImportReview
          pending={files.pending}
          problem={files.problem}
          saving={files.busy}
          onConfirm={(overwrite) => void files.confirmImport(overwrite)}
          onCancel={files.clear}
        />
      )
    }
    return (
      <div className={shell.detailBody}>
        <FilesBlank problem={files.problem} savedTo={files.savedTo} />
      </div>
    )
  }
  if (view.kind === 'repairs') {
    return (
      <RepairsView
        repairs={repairs}
        routineId={view.routineId}
        names={names}
        definitions={definitions}
        onOpenRun={onOpenRun}
      />
    )
  }
  if (run) {
    return (
      <ThreadView
        run={run}
        plannedSteps={plannedSteps}
        definition={runDefinition}
        warnAboutTab={warnAboutTab}
        onSave={onSave}
        onDelete={onDelete}
        onRerun={onRerun}
        onResume={onResume}
      />
    )
  }
  return (
    <div className={shell.detailBody}>
      <ThreadBlank connected={connected} />
    </div>
  )
}

function useAutomationDefinitions(
  automations: ReturnType<typeof useAutomations>
): Map<string, RoutineDefinition> {
  return useMemo(() => {
    const byId = new Map<string, RoutineDefinition>()
    for (const routine of automations.yours) byId.set(routine.id, routine.definition)
    return byId
  }, [automations.yours])
}

function useRunDefinition(
  automations: ReturnType<typeof useAutomations>,
  run: RunDetail | null
): RoutineDefinition | null {
  return useMemo(() => {
    if (!run?.routineId) return null
    const pool = run.routineKind === 'system' ? automations.builtIn : automations.yours
    const routine = pool.find((candidate) => candidate.id === run.routineId)
    return routine?.definition ?? null
  }, [automations.builtIn, automations.yours, run?.routineId, run?.routineKind])
}

function useAutomationNames(automations: ReturnType<typeof useAutomations>): Map<string, string> {
  return useMemo(() => {
    const names = new Map<string, string>()
    for (const routine of automations.builtIn) names.set(routine.id, routine.name)
    for (const routine of automations.yours) names.set(routine.id, routine.name)
    return names
  }, [automations.builtIn, automations.yours])
}

// A step the run has not reached yet has no event to describe it, so its line
// comes from the routine it is running.
function usePlannedSteps(automations: ReturnType<typeof useAutomations>, run: RunDetail | null): string[] {
  return useMemo(() => {
    if (!run?.routineId) return []
    const pool = run.routineKind === 'system' ? automations.builtIn : automations.yours
    const routine = pool.find((candidate) => candidate.id === run.routineId)
    return routine ? routine.definition.steps.map(describeStep) : []
  }, [automations.builtIn, automations.yours, run?.routineId, run?.routineKind])
}
