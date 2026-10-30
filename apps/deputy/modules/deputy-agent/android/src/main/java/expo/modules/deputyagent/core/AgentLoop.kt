package expo.modules.deputyagent.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive

/** The phone, as the loop sees it. `read` is only called after `Policy.preObserve` allowed the app in front. */
interface Device {
  suspend fun foregroundPkg(): String
  fun read(): Screen
  suspend fun screenshot(): String?
  fun resolveApp(name: String): List<Pair<String, String>>
  fun resolveLink(url: String): String?
  /** The clock app that would take an alarm or timer. */
  fun resolveClock(): String?
  /** Android version, battery, storage, next alarm, network and time; reads no app's screen. */
  fun info(): String
  /** Matching contacts with their numbers, or why there are none. */
  fun contacts(name: String): String
  /** The app that keeps the contacts, judged before they're read. */
  fun resolveContacts(): String?
  suspend fun perform(action: Action, target: NodeRef?): String
  suspend fun settle()
}

enum class RunStatus { DONE, FAILED, STOPPED, DECLINED, CAPPED, INTERRUPTED }

data class RunResult(val status: RunStatus, val summary: String?)

sealed interface RunEvent {
  /** `modelMs` is the model call that chose the step, `actMs` the action plus the wait for the screen to settle. */
  data class Step(
    val runId: String, val n: Int, val app: String, val action: String, val verdict: String, val result: String, val costUsd: Double,
    val modelMs: Long = 0, val actMs: Long = 0,
  ) : RunEvent
  data class GateOpened(val gate: Gate) : RunEvent
  data class Finished(val runId: String, val status: RunStatus, val summary: String?, val costUsd: Double) : RunEvent
}

class AgentLoop(
  private val runId: String,
  private val device: Device,
  private val provider: LlmProvider,
  private val gates: Gates,
  private val policy: Policy,
  private val guard: Guard,
  private val observer: ObservationBuilder,
  private val systemPrompt: String,
  private val emit: (RunEvent) -> Unit,
  /** False for a model that can't read images: no screenshot is ever taken or sent. */
  private val images: Boolean = true,
  private val now: () -> Long = System::currentTimeMillis,
) {
  // Only the latest screen is sent in full (`shorten`), which keeps a 30-step run well inside the model's window.
  private val history = mutableListOf<Msg>()
  private var modelMs = 0L
  private var actMs = 0L
  private var verdict = "" // of the latest logged step, so a batch only goes on after a step that simply ran

  /** `memory` is `RunStore.recall`'s record of earlier runs, sent with the task as data. */
  suspend fun run(task: String, memory: String? = null): RunResult {
    history += Msgs.system(systemPrompt)
    history += Msgs.user("The owner's task: $task" + memory?.let { "\n\n$it" }.orEmpty())
    var backs = 0
    var note = ""
    var prevScreen: String? = null
    var unchanged = 0
    var look = true
    var recents = false
    var recentsPkg: String? = null
    var last: Pair<String, Call>? = null
    var repeats = 0
    var shown = -1 // where the full screen sits in history, and its shortened form
    var stub = ""
    try {
      while (true) {
        guard.tripped()?.let { return end(RunStatus.CAPPED, guard.describe(it)) }
        val front = device.foregroundPkg()
        val obs = observer.build(front) { device.read() }
        if (obs == null) {
          if (backs == 2) return end(RunStatus.FAILED, "A blocked app stayed on screen, so Deputy stopped without reading it.")
          backs++
          val own = front == policy.self
          perform(Action.Press(if (own) Button.HOME else Button.BACK), null)
          note = if (own) "Deputy's own screen was in front, so Deputy went to the home screen.\n" else "A blocked app was in front, so Deputy pressed Back without reading it.\n"
          continue
        }
        backs = 0
        unchanged = if (obs.text == prevScreen) unchanged + 1 else 0
        prevScreen = obs.text
        val wanted = images && (look || obs.labelled < 5 || unchanged >= 2)
        // Recents shows other apps' last screens, Deputy's and blocked ones included, until another app comes forward.
        if (recents) recentsPkg = obs.context.pkg else if (obs.context.pkg != recentsPkg) recentsPkg = null
        recents = false
        val safe = obs.screenshotSafe && recentsPkg == null && obs.context.pkg != SYSTEM_UI && policy.preObserve(device.foregroundPkg())
        val shot = if (wanted && safe) device.screenshot() else null
        look = false
        val withheld = when {
          !images && obs.labelled < 5 -> "\n(Little text on this screen, and this model can't see screenshots.)"
          wanted && !safe -> "\n(No screenshot: another app's private content may be on screen.)"
          wanted && shot == null -> "\n(No screenshot: the app hides its screen from capture, or the capture failed.)"
          else -> ""
        }
        if (shown >= 0) history[shown] = Msgs.user(stub)
        shown = history.size
        stub = note + obs.text.substringBefore('\n') + "\n(shortened)\n</screen>"
        history += Msgs.user(note + obs.text + withheld, shot)
        note = ""

        val asked = now()
        val turn = provider.step(history, Tools.specs(images))
        modelMs = now() - asked
        actMs = 0
        history += turn.raw
        guard.addUsage(turn.usage)
        guard.countStep()
        val first = turn.toolCalls.firstOrNull()
        if (first == null) {
          history += Msgs.user("Answer with one tool call. Call finish when the task is done or can't be done.")
          step(obs, "No tool call", "none", "asked for one tool call")
          continue
        }
        val call = Tools.parse(first)
        repeats = if (last == obs.text to call) repeats + 1 else 1
        last = obs.text to call
        if (repeats >= 5) return end(RunStatus.FAILED, "Deputy got stuck: the same step changed nothing five times.")

        val result = when (call) {
          is Call.Finish -> return end(if (call.done) RunStatus.DONE else RunStatus.FAILED, call.summary)
          is Call.Invalid -> call.error.also { step(obs, first.name, "none", it) }
          Call.Info -> device.info().also { step(obs, "Phone info", "allow", it) }
          is Call.FindContact -> when (val v = policy.lookup(device.resolveContacts())) {
            is Verdict.Deny -> "denied: ${v.reason}".also { step(obs, "Find contact ${call.name}", "deny", it) }
            else -> device.contacts(call.name).also { step(obs, "Find contact ${call.name}", "allow", it) }
          }
          is Call.Ask -> {
            val gate = gates.open(runId, GateKind.QUESTION, obs.app, call.question, options = call.options)
            emit(RunEvent.GateOpened(gate))
            step(obs, "Ask the owner", "question", WAITING)
            val answer = gates.await(gate) ?: return end(RunStatus.FAILED, "The owner didn't answer within five minutes.")
            "The owner answered: ${answer.text.orEmpty()}"
          }
          is Call.OpenApp -> {
            val matches = device.resolveApp(call.name)
            when (val pkg = pickApp(call.name, matches)) {
              null -> appChoices(call.name, matches).also { step(obs, "Open ${call.name}", "none", it) }
              else -> act(obs, Action.OpenApp(pkg), false, turn.text) ?: return declined()
            }
          }
          is Call.Act -> {
            if (call.action == Action.Look) look = true
            if (call.action == Action.Press(Button.RECENTS)) recents = true
            act(obs, call.action, call.irreversible, turn.text) ?: return declined()
          }
        }
        history += Msgs.tool(first.id, if (repeats >= 3) "$result That did nothing. Try something else." else result)
        var ran = call is Call.Act && verdict == "allow"
        val calls = mutableSetOf(first.name to first.args)
        for ((i, extra) in turn.toolCalls.drop(1).withIndex()) {
          val r = when {
            !ran -> "not run: an earlier step in this reply didn't run. Look at the new screen."
            i >= MAX_BATCH - 1 -> "not run: at most $MAX_BATCH steps run from one reply."
            !calls.add(extra.name to extra.args) -> "not run: the same step twice in one reply."
            guard.tripped() != null -> "not run: a limit was reached."
            else -> batched(obs, extra)
          }
          ran = ran && verdict == "allow" && !r.startsWith("not run")
          history += Msgs.tool(extra.id, r)
        }
      }
    } catch (e: CancellationException) {
      end(RunStatus.STOPPED, "Stopped by the owner.")
      throw e
    } catch (e: ProviderError) {
      return end(RunStatus.FAILED, e.message)
    } catch (e: Exception) {
      return end(RunStatus.FAILED, "Deputy hit an error and stopped: ${e.message}")
    }
  }

  /**
   * A further call in the same reply, aimed at the screen the model saw. It runs only if its element is still there,
   * unchanged, on a fresh read, and the policy allows it outright: anything that needs the owner gets its own turn.
   */
  private suspend fun batched(seen: Observation, tc: ToolCall): String {
    val call = Tools.parse(tc)
    val action = (call as? Call.Act)?.action
    val index = when (action) {
      is Action.Tap -> action.index
      is Action.LongPress -> action.index
      is Action.TypeText -> action.index
      else -> return "not run: only taps and typing on the screen you saw can follow another step in the same reply."
    }
    val old = seen.nodes[index] ?: return "not run: element $index isn't on that screen."
    val now = observer.build(device.foregroundPkg()) { device.read() }
    val moved = now?.nodes?.entries?.firstOrNull { it.value == old }?.key?.let { j ->
      when (action) {
        is Action.Tap -> action.copy(index = j)
        is Action.LongPress -> action.copy(index = j)
        is Action.TypeText -> action.copy(index = j)
        else -> null
      }
    }
    if (now == null || moved == null) return "not run: the screen changed after the previous step. Look at the new screen."
    val target = targetOf(now, moved)
    val what = describe(moved, target)
    return when (val v = policy.check(moved, target, now.context, call.irreversible)) {
      Verdict.Allow -> perform(moved, target).also { step(now, what, "allow", it) }
      is Verdict.Deny -> "denied: ${v.reason}".also { step(now, what, "deny", it) }
      is Verdict.Confirm -> "not run: this step needs the owner's approval, so it gets its own turn. Call it again on the new screen."
    }
  }

  private suspend fun act(obs: Observation, requested: Action, flag: Boolean, reason: String?): String? {
    val action = when (requested) {
      is Action.TapAt -> {
        val scale = (obs.viewport.right - obs.viewport.left).toDouble() / SHOT_WIDTH
        Action.TapAt(obs.viewport.left + (requested.x * scale).toInt(), obs.viewport.top + (requested.y * scale).toInt())
      }
      is Action.OpenLink -> requested.copy(handler = device.resolveLink(requested.url))
      is Action.SetAlarm -> requested.copy(handler = device.resolveClock())
      is Action.SetTimer -> requested.copy(handler = device.resolveClock())
      else -> requested
    }
    val target = targetOf(obs, action)
    val what = describe(action, target)
    return when (val v = policy.check(action, target, obs.context, flag)) {
      Verdict.Allow -> perform(action, target).also { step(obs, what, "allow", it) }
      is Verdict.Deny -> "denied: ${v.reason}".also { step(obs, what, "deny", it) }
      is Verdict.Confirm -> {
        val draft = draft(obs, action)
        val gate = gates.open(runId, GateKind.CONFIRM, obs.app, v.action, v.target, draft, reason)
        emit(RunEvent.GateOpened(gate))
        step(obs, what, "confirm", WAITING)
        if (gates.await(gate)?.approved != true) {
          step(obs, what, "confirm", "declined")
          return null
        }
        // Rule 5: an approval covers the screen and message the owner was shown; if either changed while they decided, nothing runs.
        var front = device.foregroundPkg()
        if (front != obs.context.pkg && (front == policy.self || front == SYSTEM_UI)) {
          perform(Action.Press(Button.BACK), null) // answered in Deputy or the open shade
          front = device.foregroundPkg()
        }
        // The app is only in front once Deputy's window or the shade has animated away, which can outlast the settle.
        for (i in 1..10) {
          if (front == obs.context.pkg || front !in setOf(policy.self, SYSTEM_UI, "")) break
          delay(300)
          front = device.foregroundPkg()
        }
        val now = observer.build(front) { device.read() }?.takeIf { it.context.pkg == obs.context.pkg }
        val fresh = when {
          now == null -> null
          targetOf(now, action) == target -> target
          action is Action.TapAt -> null // a point can't follow its element
          else -> target?.let { DeviceRules.relocate(now.all, it) }
        }
        val lost = now != null && fresh == null && (target ?: targetOf(now, action)) != null
        if (now == null || lost || draft(now, action) != draft) {
          return "stale_screen: the screen changed while the owner decided, so nothing was done. Look again.".also { step(obs, what, "confirm", it) }
        }
        perform(action, fresh).also { step(obs, what, "confirm", it) }
      }
    }
  }

  /** The message a gate shows: the text typing puts in the field, or else the last text box's content. */
  private fun draft(obs: Observation, action: Action) =
    if (action is Action.TypeText) action.text else obs.all.lastOrNull { it.visible && it.editable && !it.password && !it.text.isNullOrBlank() }?.text

  private fun targetOf(obs: Observation, action: Action): NodeRef? = when (action) {
    is Action.Tap -> action.index.takeIf { it in obs.nodes }?.let(obs::clickTarget)
    is Action.LongPress -> action.index.takeIf { it in obs.nodes }?.let(obs::clickTarget)
    is Action.TypeText -> obs.nodes[action.index]
    is Action.Scroll -> action.index?.let(obs.nodes::get)
    is Action.TapAt -> obs.hit(action.x, action.y)?.let(obs::clickTarget)
    else -> null
  }

  private suspend fun perform(action: Action, target: NodeRef?): String {
    currentCoroutineContext().ensureActive()
    val start = now()
    return device.perform(action, target).also {
      device.settle()
      actMs = now() - start
    }
  }

  private fun pickApp(name: String, matches: List<Pair<String, String>>): String? =
    matches.singleOrNull { it.first == name }?.first
      ?: matches.singleOrNull { it.second.equals(name, ignoreCase = true) }?.first
      ?: matches.singleOrNull()?.first

  private fun appChoices(name: String, matches: List<Pair<String, String>>) =
    if (matches.isEmpty()) "No installed app is called $name."
    else "Several apps match $name: ${matches.joinToString { "${it.second} (${it.first})" }}. Call open_app with the package name in brackets."

  private fun describe(a: Action, t: NodeRef?) = when (a) {
    is Action.OpenApp -> "Open ${a.pkg}"
    is Action.OpenLink -> "Open link ${a.url}"
    is Action.Press -> "Press ${a.button.name.lowercase()}"
    is Action.OpenSettings -> "Open ${a.page} settings"
    is Action.SetAlarm -> "Set an alarm for %02d:%02d".format(a.hour, a.minute)
    is Action.SetTimer -> "Start a timer for " + if (a.seconds % 60 == 0) "${a.seconds / 60} min" else "${a.seconds} s"
    else -> a::class.simpleName.orEmpty() + t?.label?.let { " \"$it\"" }.orEmpty()
  }

  private fun step(obs: Observation, action: String, verdict: String, result: String) {
    this.verdict = verdict
    emit(RunEvent.Step(runId, guard.steps, obs.app, action, verdict, result, guard.costUsd, modelMs, actMs))
    actMs = 0 // a later step in the same reply that never runs mustn't show this one's time
  }

  private fun declined() = end(RunStatus.DECLINED, "The owner said no, so Deputy stopped before that step.")

  private fun end(status: RunStatus, summary: String?): RunResult {
    emit(RunEvent.Finished(runId, status, summary, guard.costUsd))
    return RunResult(status, summary)
  }

  companion object {
    const val MAX_BATCH = 5
    const val SHOT_WIDTH = 720 // screenshots reach the model at this width, so tap_at uses these pixels
    private const val WAITING = "waiting for the owner"
  }
}
