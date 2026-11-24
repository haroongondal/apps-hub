import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  ActionStep,
  AutomationProgressEvent,
  ProgressStatus,
  RoutineDefinition,
  RunArtifact,
  ResolvedBy,
  ResumeDescriptor,
  RunObserver,
  RunResult,
  RunStepRecord,
  StepRepair,
} from '../../shared/types';
import { describeStep, resolveStep } from '../../shared/routines';
import { MAX_REPAIRS_PER_RUN } from '../../shared/resume';
import {
  CONTROL_KINDS,
  controlFact,
  obstacleFact,
  originOf,
  routeFact,
  siteDigest,
} from '../../shared/site-memory';
import type { SiteFact, SiteMemoryReader } from '../../shared/site-memory';
import {
  ClaudeAutomationClient,
  describeAvoid,
  describePage,
  MODEL,
  type AgentAction,
} from './claude-client';
import { runDryRun } from './dry-run';
import type { DryRunReport } from '../../shared/dry-run';
import { RunMeter } from './run-meter';
import {
  AssertionFailedError,
  isHealable,
  RunCancelledError,
  RunPausedError,
  type AutomationSession,
  type PageSnapshot,
  type StepOutput,
} from './session';
import { StepHealer, type Repair, type StepContext } from './step-healer';
import { StepIndeterminateError } from './extension-bridge';
import { debugDom, debugRecord, debugging, fingerprint } from './debug-log';
import { KEEP_PAGES, pruneThread } from './thread';

const MAX_CHAT_STEPS = 100;
const MAX_CHAT_FAILURES = 6;
const MAX_ATTEMPTS_PER_STEP = 3;
const MAX_STATIC_LOOKS = 8;
const MAX_HUMAN_HOLDS = 30;

const NO_REACTION = 'the action ran but the page did not react to it at all';

export interface RoutineRun {
  name: string;
  description: string | null;
  definition: RoutineDefinition;
}

interface StepReporter {
  healing(description: string): void;
  paused(): void;
  repaired(repair: Omit<StepRepair, 'stepIndex'>): void;
}

type NavigateStep = Extract<ActionStep, { kind: 'navigate' }>;

type Emit = (
  status: ProgressStatus,
  stepIndex: number,
  description: string,
  resolved?: ActionStep
) => void;

export class OrchestratorBusyError extends Error {
  constructor() {
    super('an automation run is already in progress');
  }
}

class NeedsHumanError extends Error {
  constructor(readonly problem: string, reason: string) {
    super(reason);
  }
}

export class AutomationOrchestrator {
  private busy = false;

  constructor(
    private readonly browser: AutomationSession,
    private readonly claude: ClaudeAutomationClient,
    private readonly landmarks: SiteMemoryReader = { forOrigin: () => [] }
  ) {}

  async dryRunRoutine(routine: RoutineRun, params: Record<string, string>): Promise<DryRunReport> {
    if (this.busy) throw new OrchestratorBusyError();
    this.busy = true;
    try {
      await this.browser.connect();
      return await runDryRun(this.browser, routine, params);
    } finally {
      await this.browser.disconnect();
      this.busy = false;
    }
  }

  async runRoutine(
    routine: RoutineRun,
    params: Record<string, string>,
    observer: RunObserver,
    resume?: ResumeDescriptor
  ): Promise<RunResult> {
    if (this.busy) throw new OrchestratorBusyError();
    this.busy = true;
    const notify = swallowingFailures(observer);
    const runId = randomUUID();
    const steps = routine.definition.steps;
    const totalSteps = steps.length;
    const goal = routine.description
      ? `${routine.name} — ${routine.description}`
      : routine.name;
    let activeStep = -1;
    let humanSteps = 0;

    const emit: Emit = (status, stepIndex, description, resolved) =>
      notify.progress({
        runId,
        source: 'routine',
        status,
        stepIndex,
        totalSteps,
        description,
        step: resolved,
      });
    const reportHold = (description: string): void => {
      humanSteps++;
      emit('held', activeStep, description);
    };
    this.browser.setHoldReporter(reason =>
      reportHold(holdNote(activeStep, reason))
    );

    const meter = new RunMeter(MODEL);

    try {
      await this.browser.connect();
      const vars = { ...params, ...resume?.vars };
      const extracted: Record<string, string> = {};
      const artifacts: RunArtifact[] = [];
      const repairs: StepRepair[] = [];
      const healer = new StepHealer(
        this.browser,
        this.claude,
        Math.max(0, MAX_REPAIRS_PER_RUN - (resume?.repairsUsed ?? 0)),
        meter,
        this.landmarks
      );
      let lastReplayed: NavigateStep | null = null;
      let pageChecked = false;
      const deposit = createDepositor(notify);

      for (const [index, step] of steps.entries()) {
        if (resume && index < resume.startIndex) {
          if (step.kind === 'navigate') {
            activeStep = index;
            this.browser.setRunContext({ runId, stepIndex: index });
            lastReplayed = await this.replayNavigate(
              runId,
              index,
              step,
              vars,
              emit,
              notify
            );
          }
          continue;
        }
        if (lastReplayed && !pageChecked) {
          pageChecked = true;
          await this.assertResumedPage(lastReplayed.url);
        }

        activeStep = index;
        this.browser.setRunContext({ runId, stepIndex: index });
        const startedAt = Date.now();
        const callsBefore = meter.totals().llmCalls;
        const telemetry = blankTelemetry();
        const context: StepContext = { goal, steps, index };
        const reporter: StepReporter = {
          healing: description => emit('healing', index, description),
          paused: () =>
            emit(
              'healing',
              index,
              `Step ${
                index + 1
              } was not run because you paused. Trying it again.`
            ),
          repaired: repair => {
            const { screenshotBase64, ...row } = repair;
            // The frame has to land first: whoever files the repair looks the
            // artifact up by run and step to attach it.
            if (screenshotBase64)
              notify.artifact(runId, {
                kind: 'repair',
                stepIndex: index,
                label: repair.reason,
                base64: screenshotBase64,
              });
            notify.repair(runId, { stepIndex: index, ...row });
          },
        };

        let output: StepOutput | null = null;
        let userStopped = false;
        // A navigating step lands on a different origin than the one whose
        // selector it used, so a deposit is filed against the page it started on.
        const urlBefore = this.browser.currentUrl();
        try {
          if (step.kind === 'extract') {
            const selector = resolveTemplate(step.selector, vars);
            emit('running', index, describeStep(step), { ...step, selector });

            const found = await this.extractWithRepair(
              step,
              selector,
              context,
              healer,
              reporter,
              telemetry
            );
            vars[step.into] = found.text;
            extracted[step.into] = found.text;
            notify.artifact(runId, {
              kind: 'extract',
              stepIndex: index,
              label: step.into,
              text: found.text,
            });
            if (found.repair)
              repairs.push({ stepIndex: index, ...found.repair });
            continue;
          }

          emit('running', index, describeStep(step), resolveStep(step, vars));

          const attempt = await this.runWithRepair(
            step,
            context,
            healer,
            vars,
            reporter,
            telemetry
          );
          output = attempt.output;
          if (attempt.repair)
            repairs.push({ stepIndex: index, ...attempt.repair });
          if (step.kind === 'screenshot' && attempt.output.value) {
            const label = step.label ?? `Step ${index + 1}`;
            artifacts.push({
              label,
              stepIndex: index,
              dataUrl: `data:image/jpeg;base64,${attempt.output.value}`,
            });
            notify.artifact(runId, {
              kind: 'screenshot',
              stepIndex: index,
              label,
              base64: attempt.output.value,
            });
          }
        } catch (error) {
          userStopped = error instanceof RunCancelledError;
          // Only messages cross IPC, so the step number has to be in the text.
          if (error instanceof AssertionFailedError) {
            throw new AssertionFailedError(
              `Step ${index + 1}: ${error.message}`
            );
          }
          if (!(error instanceof NeedsHumanError)) throw error;
          // The human does this step themselves, so resuming continues past it.
          // Re-running what they just did by hand is the wrong kind of retry.
          telemetry.resolvedBy = 'human';
          reportHold(
            `Step ${index + 1} needs you: ${
              error.problem
            }. Do it in the browser, then press Resume.`
          );
          const heldFrom = Date.now();
          await this.browser.holdForHuman(
            `step ${index + 1} needs you — ${error.problem}`
          );
          telemetry.heldMs += Date.now() - heldFrom;
        } finally {
          notify.step(runId, {
            stepIndex: index,
            kind: step.kind,
            startedAt,
            endedAt: Date.now(),
            llmCalls: meter.totals().llmCalls - callsBefore,
            staticLooks: null,
            threadTurns: null,
            stopReason: null,
            pageFingerprint: null,
            thinking: null,
            ...telemetry,
          });
          if (!userStopped && urlBefore !== null) {
            deposit(step, telemetry.resolvedBy, output, urlBefore);
          }
          notify.usage(runId, meter.totals());
        }
      }

      emit(humanSteps > 0 ? 'assisted' : 'done', totalSteps, 'Finished');
      return { runId, extracted, artifacts, repairs };
    } catch (error) {
      const cancelled = error instanceof RunCancelledError;
      const errorKind = classifyFailure(error);
      notify.progress({
        runId,
        source: 'routine',
        status: cancelled ? 'cancelled' : 'error',
        stepIndex: activeStep,
        totalSteps,
        description: cancelled ? 'Cancelled' : 'Failed',
        error: errorMessage(error),
        ...(errorKind === null ? {} : { errorKind }),
      });
      throw error;
    } finally {
      notify.usage(runId, meter.totals());
      this.browser.setRunContext(null);
      this.browser.setHoldReporter(null);
      await this.browser.disconnect();
      this.busy = false;
    }
  }

  private async replayNavigate(
    runId: string,
    index: number,
    step: NavigateStep,
    vars: Record<string, string>,
    emit: Emit,
    notify: Required<RunObserver>
  ): Promise<NavigateStep> {
    const startedAt = Date.now();
    const resolved: NavigateStep = {
      ...step,
      url: resolveTemplate(step.url, vars),
    };
    emit('running', index, describeStep(step), resolved);
    await throughPauses(
      () => this.browser.runStep(step, vars),
      () =>
        emit(
          'healing',
          index,
          `Step ${
            index + 1
          } was not replayed because you paused. Trying it again.`
        )
    );
    notify.step(runId, {
      stepIndex: index,
      kind: 'navigate',
      attempts: 1,
      resolvedBy: 'resumed',
      changed: null,
      via: null,
      recovered: null,
      committing: null,
      browserMs: Date.now() - startedAt,
      modelMs: 0,
      heldMs: 0,
      llmCalls: 0,
      startedAt,
      endedAt: Date.now(),
      staticLooks: null,
      threadTurns: null,
      stopReason: null,
      pageFingerprint: null,
      thinking: null,
    });
    return resolved;
  }

  // A whole snapshot for one URL beats a currentUrl() on both backends and every fake.
  private async assertResumedPage(expected: string): Promise<void> {
    const seen = await this.browser.snapshot();
    if (samePage(seen.url, expected)) return;
    throw new Error(
      `resuming expected the browser to be on ${expected}, but it is on ${seen.url} — ` +
        'run this automation from the start instead'
    );
  }

  private async runWithRepair(
    step: ActionStep,
    context: StepContext,
    healer: StepHealer,
    vars: Record<string, string>,
    reporter: StepReporter,
    telemetry: StepTelemetry
  ): Promise<{
    output: StepOutput;
    repair: Omit<StepRepair, 'stepIndex'> | null;
  }> {
    let actions = [step];
    let repair: Omit<StepRepair, 'stepIndex'> | null = null;
    let problem = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_STEP; attempt++) {
      telemetry.attempts = attempt + 1;
      try {
        const output = await this.throughPausesTimed(
          () => this.runActions(actions, vars),
          reporter,
          telemetry
        );
        telemetry.changed = output.changed ?? null;
        telemetry.via = output.via ?? null;
        telemetry.recovered = output.recovered ?? null;
        telemetry.committing = output.committing ?? null;
        if (output.changed !== false) {
          telemetry.resolvedBy = settled(repair, output.recovered);
          return { output, repair };
        }

        // A no-op verdict is a reason to look, never a reason to click again:
        // a false one would re-submit an order the first click already placed.
        if (output.committing)
          throw new NeedsHumanError(
            NO_REACTION,
            'this step commits something, so it is never retried'
          );
        problem = NO_REACTION;
      } catch (error) {
        if (error instanceof NeedsHumanError) throw error;
        if (!isHealable(error)) throw error;
        problem = errorMessage(error);
      }

      const plan = await this.planTimed(healer, context, problem, telemetry);
      if (plan.outcome === 'proceed') {
        telemetry.resolvedBy = 'proceed';
        return { output: {}, repair };
      }
      if (plan.outcome === 'giveUp')
        throw new NeedsHumanError(problem, plan.reason);

      reporter.healing(`Repairing step: ${plan.reason}`);
      actions = plan.actions.map(toActionStep);
      repair = { reason: plan.reason, original: step, replacement: actions };
      reporter.repaired({
        ...repair,
        screenshotBase64: plan.screenshotBase64 ?? undefined,
      });
    }

    throw new NeedsHumanError(
      problem,
      `still failing after ${MAX_ATTEMPTS_PER_STEP} attempts`
    );
  }

  private async extractWithRepair(
    step: Extract<ActionStep, { kind: 'extract' }>,
    selector: string,
    context: StepContext,
    healer: StepHealer,
    reporter: StepReporter,
    telemetry: StepTelemetry
  ): Promise<{ text: string; repair: Omit<StepRepair, 'stepIndex'> | null }> {
    let target = selector;
    let repair: Omit<StepRepair, 'stepIndex'> | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_STEP; attempt++) {
      telemetry.attempts = attempt + 1;
      try {
        const text = await this.throughPausesTimed(
          () => this.browser.extractText(target),
          reporter,
          telemetry
        );
        telemetry.resolvedBy = settled(repair, null);
        return { text, repair };
      } catch (error) {
        if (!isHealable(error)) throw error;
        const problem = errorMessage(error);
        const plan = await this.planTimed(healer, context, problem, telemetry);
        if (plan.outcome !== 'retry')
          throw new NeedsHumanError(problem, plan.reason);

        const replacement = plan.actions.find(
          action => action.selector
        )?.selector;
        if (!replacement)
          throw new NeedsHumanError(
            problem,
            'the repair named nothing to read from'
          );

        reporter.healing(`Repairing step: ${plan.reason}`);
        target = replacement;
        repair = {
          reason: plan.reason,
          original: step,
          replacement: [{ ...step, selector: target }],
        };
        reporter.repaired({
          ...repair,
          screenshotBase64: plan.screenshotBase64 ?? undefined,
        });
      }
    }

    throw new NeedsHumanError(
      `could not read ${step.selector}`,
      `still failing after ${MAX_ATTEMPTS_PER_STEP} attempts`
    );
  }

  private async throughPausesTimed<T>(
    work: () => Promise<T>,
    reporter: StepReporter,
    telemetry: StepTelemetry
  ): Promise<T> {
    const started = Date.now();
    const browserBefore = telemetry.browserMs;
    try {
      return await throughPauses(async () => {
        const attemptStarted = Date.now();
        try {
          return await work();
        } finally {
          telemetry.browserMs += Date.now() - attemptStarted;
        }
      }, reporter.paused);
    } finally {
      const spentInBrowser = telemetry.browserMs - browserBefore;
      telemetry.heldMs += Date.now() - started - spentInBrowser;
    }
  }

  private async planTimed(
    healer: StepHealer,
    context: StepContext,
    problem: string,
    telemetry: StepTelemetry
  ): Promise<Repair> {
    const started = Date.now();
    try {
      return await healer.plan(context, problem);
    } finally {
      telemetry.modelMs += Date.now() - started;
    }
  }

  private async runActions(
    actions: ActionStep[],
    vars: Record<string, string>
  ): Promise<StepOutput> {
    let last: StepOutput = {};
    for (const action of actions)
      last = await this.browser.runStep(action, vars);
    return last;
  }

  async runChatGoal(
    sessionId: string,
    goal: string,
    observer: RunObserver
  ): Promise<void> {
    if (this.busy) throw new OrchestratorBusyError();
    this.busy = true;
    const notify = swallowingFailures(observer);
    const runId = randomUUID();
    const recordedSteps: ActionStep[] = [];
    const messages: Anthropic.MessageParam[] = [];
    let outstanding: string | null = null;
    let outcome: string | null = null;
    // What has failed since the last thing that worked. A step that succeeds, or
    // a new URL, can put the missing element on the page — on a single-page app
    // only the former does — so either one clears it. The value is the page's own
    // error, so ending the run reports that rather than a paraphrase.
    let deadTargets = new Map<string, Error>();
    let deadOn: string | null = null;
    let consecutiveFailures = 0;
    let activeStep = -1;
    let lastFrame: string | null | undefined = undefined;
    let lastSignature: string | null | undefined = undefined;
    let staticLooks = 0;
    let humanSteps = 0;
    let humanHolds = 0;
    const digestedOrigins = new Set<string>();

    const meter = new RunMeter(MODEL);
    let measure = blankMeasure();
    const fileStep = (
      index: number,
      kind: ActionStep['kind'],
      resolvedBy: ResolvedBy,
      output: StepOutput | null
    ): void => {
      notify.step(runId, {
        stepIndex: index,
        kind,
        attempts: 1,
        resolvedBy,
        changed: output?.changed ?? null,
        via: output?.via ?? null,
        recovered: output?.recovered ?? null,
        committing: output?.committing ?? null,
        browserMs: measure.browserMs,
        modelMs: measure.modelMs,
        heldMs: measure.heldMs,
        llmCalls: meter.totals().llmCalls - measure.callsBefore,
        startedAt: measure.startedAt,
        endedAt: Date.now(),
        staticLooks: measure.staticLooks,
        threadTurns: measure.threadTurns,
        stopReason: measure.stopReason,
        pageFingerprint: measure.pageFingerprint,
        thinking: measure.thinking,
      });
      notify.usage(runId, meter.totals());
    };
    const deposit = createDepositor(notify);

    const note = (text: string): void => {
      outcome = outcome === null ? text : `${outcome}\n${text}`;
    };
    let trace: Record<string, unknown> | null = null;
    const traceStep = (fields: Record<string, unknown>): void => {
      if (trace) Object.assign(trace, fields);
    };
    const flushTrace = (): void => {
      if (trace) debugRecord(runId, trace);
      trace = null;
    };
    // The recording must land before the terminal event settles the thread.
    const settle = (event: AutomationProgressEvent): void => {
      notify.recorded(runId, recordedSteps);
      notify.progress(event);
    };
    const handOff = async (reason: string): Promise<void> => {
      humanHolds++;
      if (humanHolds > MAX_HUMAN_HOLDS)
        throw new Error(
          `the page still needed you after ${MAX_HUMAN_HOLDS} hand-offs, so this run stopped`
        );
      humanSteps++;
      notify.progress({
        runId,
        source: 'chat',
        sessionId,
        status: 'held',
        stepIndex: activeStep,
        description: holdNote(activeStep, reason),
      });
      await this.browser.holdForHuman(
        `step ${activeStep + 1} needs you — ${reason}`
      );
      note(
        `A person was asked to help here: ${reason}. Carry on from the page they left behind.`
      );
      traceStep({ outcome: { handOff: reason } });
      deadTargets = new Map();
      consecutiveFailures = 0;
      staticLooks = 0;
    };
    this.browser.setHoldReporter(reason => {
      humanSteps++;
      notify.progress({
        runId,
        source: 'chat',
        sessionId,
        status: 'held',
        stepIndex: activeStep,
        description: holdNote(activeStep, reason),
      });
    });

    try {
      await this.browser.connect();
      notify.progress({
        runId,
        source: 'chat',
        sessionId,
        status: 'running',
        stepIndex: -1,
        description: 'Reading the page and choosing the first step.',
      });
      if (debugging())
        debugRecord(runId, {
          kind: 'run',
          runId,
          goal,
          budgets: {
            MAX_CHAT_STEPS,
            MAX_CHAT_FAILURES,
            MAX_STATIC_LOOKS,
            MAX_HUMAN_HOLDS,
            KEEP_PAGES,
          },
        });
      for (let i = 0; i < MAX_CHAT_STEPS; i++) {
        activeStep = i;
        flushTrace();
        if (debugging()) trace = { kind: 'step', step: i, at: Date.now() };
        this.browser.setRunContext({ runId, stepIndex: i });
        const startedAt = Date.now();
        measure = {
          ...blankMeasure(),
          startedAt,
          callsBefore: meter.totals().llmCalls,
        };
        const snapshot = await this.browser.snapshot();
        const signature = pageSignature(snapshot);
        measure.pageFingerprint = fingerprint(signature);
        if (debugging()) {
          debugDom(runId, i, snapshot.dom);
          traceStep({
            snapshotMs: Date.now() - startedAt,
            url: snapshot.url,
            title: snapshot.title,
            domChars: snapshot.dom.length,
            domError: snapshot.domError,
            frame: snapshot.screenshotBase64 === null ? null : 'captured',
            frameError: snapshot.screenshotError,
            blockedBy: snapshot.blockedBy,
            page: fingerprint(signature),
            pageFrom: snapshot.domError ? 'frame' : 'dom',
          });
        }
        if (signature !== null && signature === lastSignature) staticLooks++;
        else staticLooks = 0;
        lastSignature = signature;
        traceStep({ staticLooks });
        measure.staticLooks = staticLooks;
        if (staticLooks >= MAX_STATIC_LOOKS)
          throw new Error(
            `the page has looked the same for ${MAX_STATIC_LOOKS} steps running, so this run is going in circles`
          );
        if (snapshot.blockedBy) {
          const wall = obstacleFact(snapshot.url, snapshot.blockedBy);
          if (wall !== null) notify.learned(wall);
          await handOff(`the page is behind a ${snapshot.blockedBy}`);
          continue;
        }
        if (snapshot.url !== deadOn) {
          deadTargets = new Map();
          deadOn = snapshot.url;
        }
        // The only place a turn is sent, so the only place `outstanding` can be
        // discharged. An undischarged tool_use is a 400 no retry can clear.
        const page = pageText(snapshot, [...deadTargets.keys()]);
        const origin = originOf(snapshot.url);
        let hints: string | null = null;
        if (origin !== null && !digestedOrigins.has(origin)) {
          digestedOrigins.add(origin);
          hints = siteDigest(this.landmarks.forOrigin(origin), origin) || null;
        }
        if (outstanding === null) {
          messages.push({
            role: 'user',
            content: pageTurn(`Goal: ${goal}`, page, snapshot, hints),
          });
        } else {
          const said = outcome ?? 'the step did not run';
          messages.push(
            toolResult(outstanding, pageTurn(said, page, snapshot, hints))
          );
          outstanding = null;
        }
        outcome = null;

        const pruned = pruneThread(messages, KEEP_PAGES);
        const askedAt = Date.now();
        const turn = await this.claude.nextAction(pruned);
        meter.record('decision', turn.usage);
        measure.modelMs += Date.now() - askedAt;
        measure.threadTurns = pruned.length;
        measure.stopReason = turn.stopReason;
        measure.thinking = turn.content.some(
          block => block.type === 'thinking'
        );
        if (debugging())
          traceStep({
            thread: {
              messages: pruned.length,
              images: JSON.stringify(pruned).split('"type":"image"').length - 1,
            },
            model: {
              ms: Date.now() - askedAt,
              stopReason: turn.stopReason,
              thinking: turn.content.some(block => block.type === 'thinking'),
              in: turn.usage?.input_tokens ?? null,
              out: turn.usage?.output_tokens ?? null,
            },
            said: turn.text,
          });
        messages.push({
          role: 'assistant',
          content: turn.content as Anthropic.ContentBlockParam[],
        });

        if (turn.stopReason === 'max_tokens')
          throw new Error(
            'the model ran out of room before choosing an action — its reply was cut off'
          );

        if (!turn.action || !turn.toolUseId) {
          settle({
            runId,
            source: 'chat',
            sessionId,
            status: humanSteps > 0 ? 'assisted' : 'done',
            stepIndex: i,
            description:
              turn.text ?? 'The model stopped without choosing an action',
          });
          return;
        }

        outstanding = turn.toolUseId;
        const decision = turn.action;
        traceStep({ decision });

        // Ahead of the terminal branches: a "done" frame is the answer's evidence.
        if (snapshot.screenshotBase64 !== lastFrame) {
          lastFrame = snapshot.screenshotBase64;
          notify.artifact(runId, {
            kind: 'screenshot',
            stepIndex: i,
            label: decision.step_description,
            ...(snapshot.screenshotBase64
              ? { base64: snapshot.screenshotBase64 }
              : { text: snapshot.screenshotError ?? 'no frame was captured' }),
          });
        }

        if (decision.action === 'done') {
          traceStep({ outcome: { done: decision.step_description } });
          settle({
            runId,
            source: 'chat',
            sessionId,
            status: humanSteps > 0 ? 'assisted' : 'done',
            stepIndex: i,
            description: decision.step_description,
          });
          return;
        }

        if (decision.action === 'needs_human') {
          await handOff(decision.step_description);
          continue;
        }

        const step = toActionStep(decision);
        const target = targetKey(step);

        const alreadyDead = target ? deadTargets.get(target) : undefined;
        if (alreadyDead) {
          consecutiveFailures++;
          const refusal = `${target} already failed on this page`;
          if (consecutiveFailures >= MAX_CHAT_FAILURES) throw alreadyDead;
          note(
            `${decision.step_description} — NOT RUN: ${refusal}. Choose a different element.`
          );
          traceStep({ outcome: { refused: refusal } });
          notify.progress({
            runId,
            source: 'chat',
            sessionId,
            status: 'healing',
            stepIndex: i,
            description: `${decision.step_description} — ${refusal}, so it was not tried again. Looking at the page again.`,
          });
          continue;
        }

        notify.progress({
          runId,
          source: 'chat',
          sessionId,
          status: 'running',
          stepIndex: i,
          description: decision.step_description,
          step,
        });

        const ranAt = Date.now();
        try {
          const output = await this.browser.runStep(step);
          measure.browserMs += Date.now() - ranAt;
          traceStep({ outcome: { ...output, ms: Date.now() - ranAt } });
          consecutiveFailures = 0;
          deadTargets.clear();
          recordedSteps.push(step);
          fileStep(i, step.kind, 'direct', output);
          deposit(step, 'direct', output, snapshot.url);
          note(describeAttempt(decision.step_description, output));
        } catch (error) {
          if (error instanceof RunPausedError) {
            note(
              `${decision.step_description} — not run, because you paused here; the page may have changed since.`
            );
            notify.progress({
              runId,
              source: 'chat',
              sessionId,
              status: 'healing',
              stepIndex: i,
              description: `${decision.step_description} — you paused here, so it was not run. Looking at the page again.`,
            });
            continue;
          }
          if (!isHealable(error)) throw error;
          if (target && error instanceof Error) deadTargets.set(target, error);
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CHAT_FAILURES) throw error;

          const detail = errorMessage(error);
          measure.browserMs += Date.now() - ranAt;
          traceStep({ outcome: { failed: detail, ms: Date.now() - ranAt } });
          fileStep(i, step.kind, 'failed', null);
          deposit(step, 'failed', null, snapshot.url);
          note(
            `${decision.step_description} — FAILED: ${detail}. That selector does not work; use a different one.`
          );
          notify.progress({
            runId,
            source: 'chat',
            sessionId,
            status: 'healing',
            stepIndex: i,
            description: `${decision.step_description} — ${detail}. Looking at the page again.`,
          });
        }
      }
      throw new Error(
        `stopped after ${MAX_CHAT_STEPS} steps without reaching the goal`
      );
    } catch (error) {
      const cancelled = error instanceof RunCancelledError;
      traceStep({ outcome: { ended: errorMessage(error) } });
      settle({
        runId,
        source: 'chat',
        sessionId,
        status: cancelled ? 'cancelled' : 'error',
        stepIndex: activeStep,
        description: cancelled ? 'Cancelled' : 'Failed',
        error: errorMessage(error),
      });
      throw error;
    } finally {
      notify.usage(runId, meter.totals());
      flushTrace();
      this.browser.setRunContext(null);
      this.browser.setHoldReporter(null);
      await this.browser.disconnect();
      this.busy = false;
    }
  }
}

export function toActionStep(decision: AgentAction): ActionStep {
  const intent = decision.step_description;
  switch (decision.action) {
    case 'click':
      if (!decision.selector)
        throw new Error('Claude returned a click action without a selector');
      return { kind: 'click', selector: decision.selector, intent };
    case 'type':
      if (!decision.selector || decision.text === undefined)
        throw new Error(
          'Claude returned a type action without a selector or text'
        );
      return {
        kind: 'type',
        selector: decision.selector,
        text: decision.text,
        ...(decision.submit ? { submit: true } : {}),
        intent,
      };
    case 'navigate':
      if (!decision.text)
        throw new Error('Claude returned a navigate action without a url');
      return { kind: 'navigate', url: decision.text, intent };
    case 'select':
      if (!decision.selector || decision.text === undefined)
        throw new Error(
          'Claude returned a select action without a selector or value'
        );
      return {
        kind: 'select',
        selector: decision.selector,
        value: decision.text,
        intent,
      };
    case 'wait':
      if (decision.selector)
        return { kind: 'wait', forSelector: decision.selector, intent };
      return { kind: 'wait', ms: decision.ms ?? 1000, intent };
    case 'scroll':
      if (decision.selector)
        return { kind: 'scroll', selector: decision.selector, intent };
      return { kind: 'scroll', to: 'bottom', intent };
    default:
      throw new Error(`unsupported action "${decision.action}"`);
  }
}

interface StepTelemetry {
  attempts: number;
  resolvedBy: ResolvedBy;
  browserMs: number;
  modelMs: number;
  heldMs: number;
  recovered: boolean | null;
  changed: boolean | null;
  committing: boolean | null;
  via: 'cdp' | 'synthetic' | null;
}

function settled(
  repair: Omit<StepRepair, 'stepIndex'> | null,
  recovered: boolean | null | undefined
): ResolvedBy {
  if (repair) return 'repair';
  return recovered ? 'recovered' : 'direct';
}

interface GoalStepMeasure {
  startedAt: number;
  callsBefore: number;
  browserMs: number;
  modelMs: number;
  heldMs: number;
  staticLooks: number;
  threadTurns: number | null;
  stopReason: string | null;
  pageFingerprint: string | null;
  thinking: boolean | null;
}

function blankMeasure(): GoalStepMeasure {
  return {
    startedAt: 0,
    callsBefore: 0,
    browserMs: 0,
    modelMs: 0,
    heldMs: 0,
    staticLooks: 0,
    threadTurns: null,
    stopReason: null,
    pageFingerprint: null,
    thinking: null,
  };
}

function blankTelemetry(): StepTelemetry {
  return {
    attempts: 0,
    resolvedBy: 'failed',
    browserMs: 0,
    modelMs: 0,
    heldMs: 0,
    recovered: null,
    changed: null,
    committing: null,
    via: null,
  };
}

function classifyFailure(error: unknown): string | null {
  if (error instanceof RunCancelledError) return 'cancelled';
  if (error instanceof StepIndeterminateError) return 'indeterminate';
  if (error instanceof AssertionFailedError) return 'assertion';
  return null;
}

function samePage(seen: string, expected: string): boolean {
  return withoutHash(seen) === withoutHash(expected);
}

function withoutHash(url: string): string {
  const [address = ''] = url.split('#');
  return address.replace(/\/$/, '');
}

function swallowingFailures(observer: RunObserver): Required<RunObserver> {
  let logged = false;
  const attempt = (label: string, deliver: () => void): void => {
    try {
      deliver();
    } catch (error) {
      if (logged) return;
      logged = true;
      console.error(
        `[automation] the run observer threw on ${label}; the run carried on without it:`,
        error
      );
    }
  };

  return {
    progress: event => attempt('progress', () => observer.progress(event)),
    artifact: (runId, artifact) =>
      attempt('artifact', () => observer.artifact?.(runId, artifact)),
    repair: (runId, repair) =>
      attempt('repair', () => observer.repair?.(runId, repair)),
    recorded: (runId, steps) =>
      attempt('recorded', () => observer.recorded?.(runId, steps)),
    step: (runId, record) =>
      attempt('step', () => observer.step?.(runId, record)),
    usage: (runId, totals) =>
      attempt('usage', () => observer.usage?.(runId, totals)),
    learned: fact => attempt('learned', () => observer.learned?.(fact)),
    scored: (origin, kind, factKey, worked) =>
      attempt('scored', () => observer.scored?.(origin, kind, factKey, worked)),
  };
}

type Depositor = (
  step: ActionStep,
  resolvedBy: ResolvedBy,
  output: StepOutput | null,
  url: string
) => void;

const PAGE_EXERCISING_KINDS = new Set<ActionStep['kind']>([
  ...CONTROL_KINDS,
  'extract',
  'assert',
]);

export function createDepositor(notify: Required<RunObserver>): Depositor {
  let pendingRoute: SiteFact | null = null;

  return (step, resolvedBy, output, url) => {
    // A served error page is a successful load, so a route earns its place
    // only once the next step on it has worked — never from the load alone.
    if (
      pendingRoute !== null &&
      resolvedBy !== 'failed' &&
      PAGE_EXERCISING_KINDS.has(step.kind)
    ) {
      notify.learned(pendingRoute);
      pendingRoute = null;
    }
    if (step.kind === 'navigate') {
      pendingRoute =
        resolvedBy === 'failed'
          ? null
          : routeFact(step.url, step.intent ?? 'a page');
      return;
    }
    // observe() already counts a hit through its ON CONFLICT, so scoring a
    // success here would count the same success twice.
    if (resolvedBy === 'failed' && CONTROL_KINDS.has(step.kind)) {
      const selector = 'selector' in step ? step.selector : null;
      const origin = originOf(url);
      if (typeof selector === 'string' && origin !== null) {
        notify.scored(origin, 'control', selector, false);
      }
    }
    const fact = controlFact({ step, resolvedBy, output, url });
    if (fact !== null) notify.learned(fact);
  };
}

async function throughPauses<T>(
  attempt: () => Promise<T>,
  onPause: () => void
): Promise<T> {
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof RunPausedError)) throw error;
      onPause();
    }
  }
}

// Only selector-driven kinds are worth remembering; the same navigate twice is
// a legitimate way to reset a page.
function targetKey(step: ActionStep): string | null {
  if (step.kind === 'click' || step.kind === 'type' || step.kind === 'select') {
    return `${step.kind} ${step.selector}`;
  }
  return null;
}

type PageBlocks = Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

export function pageTurn(
  lead: string,
  page: string,
  snapshot: PageSnapshot,
  hints: string | null = null
): PageBlocks {
  const opening = `${lead}\nURL at this point: ${snapshot.url}`;
  const blocks: PageBlocks = [
    { type: 'text', text: hints ? `${opening}\n\n${hints}` : opening },
    { type: 'text', text: page },
  ];
  if (snapshot.screenshotBase64)
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: snapshot.screenshotBase64,
      },
    });
  return blocks;
}

function toolResult(id: string, blocks: PageBlocks): Anthropic.MessageParam {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: blocks }],
  };
}

function pageText(snapshot: PageSnapshot, avoid: string[]): string {
  const sections = describePage(snapshot);
  if (avoid.length > 0) sections.push(describeAvoid(avoid));
  return sections.join('\n\n');
}

const VOLATILE_ID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// A caret blink changes the JPEG; a restamped request id changes the DOM.
function pageSignature(snapshot: PageSnapshot): string | null {
  if (!snapshot.domError) return snapshot.dom.replace(VOLATILE_ID, '');
  return snapshot.screenshotBase64;
}

function holdNote(stepIndex: number, reason: string): string {
  return (
    `Step ${stepIndex + 1} is waiting for you: ${reason}. ` +
    'Handle it in the browser, then press Resume.'
  );
}

function describeAttempt(description: string, output: StepOutput): string {
  if (output.changed === false)
    return `${description} — it ran, but the page did not visibly react`;
  return `${description} — it ran`;
}

function resolveTemplate(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
