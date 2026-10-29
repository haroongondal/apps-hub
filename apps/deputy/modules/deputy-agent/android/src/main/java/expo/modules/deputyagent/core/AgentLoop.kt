package expo.modules.deputyagent.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** The phone, as the loop sees it. `read` is only called after `Policy.preObserve` allowed the app in front. */
interface Device {
  suspend fun foregroundPkg(): String
  fun read(): Screen
  suspend fun screenshot(): String?
  fun resolveApp(name: String): List<Pair<String, String>>
  fun resolveLink(url: String): String?
  suspend fun perform(action: Action, target: NodeRef?): String
  suspend fun settle()
}

enum class RunStatus { DONE, FAILED, STOPPED, DECLINED, CAPPED, INTERRUPTED }

data class RunResult(val status: RunStatus, val summary: String?)

sealed interface RunEvent {
  data class Step(val runId: String, val n: Int, val app: String, val action: String, val verdict: String, val result: String, val costUsd: Double) : RunEvent
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
) {
  // shortcut: history is never summarised (SPEC §7 at 60% of context); add it if a 30-step run nears the model's window.
  private val history = mutableListOf<Msg>()

  suspend fun run(task: String): RunResult {
    history += Msgs.system(systemPrompt)
    history += Msgs.user("The owner's task: $task")
    var backs = 0
    var note = ""
    var prevScreen: String? = null
    var unchanged = 0
    var look = true
    var recents = false
    var recentsPkg: String? = null
    var last: Pair<String, Call>? = null
    var repeats = 0
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
        val wanted = look || obs.labelled < 5 || unchanged >= 2
        // Recents shows other apps' last screens, Deputy's and blocked ones included, until another app comes forward.
        if (recents) recentsPkg = obs.context.pkg else if (obs.context.pkg != recentsPkg) recentsPkg = null
        recents = false
        val safe = obs.screenshotSafe && recentsPkg == null && obs.context.pkg != SYSTEM_UI && policy.preObserve(device.foregroundPkg())
        val shot = if (wanted && safe) device.screenshot() else null
        look = false
        val withheld = when {
          wanted && !safe -> "\n(No screenshot: another app's private content may be on screen.)"
          wanted && shot == null -> "\n(No screenshot: the app hides its screen from capture, or the capture failed.)"
          else -> ""
        }
        history += Msgs.user(note + obs.text + withheld, shot)
        note = ""

        val turn = provider.step(history, Tools.specs)
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
        turn.toolCalls.drop(1).forEach { history += Msgs.tool(it.id, "error: one action per step") }
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

  private suspend fun act(obs: Observation, requested: Action, flag: Boolean, reason: String?): String? {
    val action = when (requested) {
      is Action.TapAt -> {
        val scale = (obs.viewport.right - obs.viewport.left).toDouble() / SHOT_WIDTH
        Action.TapAt(obs.viewport.left + (requested.x * scale).toInt(), obs.viewport.top + (requested.y * scale).toInt())
      }
      is Action.OpenLink -> requested.copy(handler = device.resolveLink(requested.url))
      else -> requested
    }
    val target = targetOf(obs, action)
    val what = describe(action, target)
    return when (val v = policy.check(action, target, obs.context, flag)) {
      Verdict.Allow -> perform(action, target).also { step(obs, what, "allow", it) }
      is Verdict.Deny -> "denied: ${v.reason}".also { step(obs, what, "deny", it) }
      is Verdict.Confirm -> {
        val draft = if (action is Action.TypeText) target?.text.orEmpty() + action.text else obs.nodes.values.lastOrNull { it.editable && !it.password && !it.text.isNullOrBlank() }?.text
        val gate = gates.open(runId, GateKind.CONFIRM, obs.app, v.action, v.target, draft, reason)
        emit(RunEvent.GateOpened(gate))
        step(obs, what, "confirm", WAITING)
        if (gates.await(gate)?.approved != true) {
          step(obs, what, "confirm", "declined")
          return null
        }
        // Rule 5: an approval covers the screen the owner was shown; if that changed while they decided, nothing runs.
        var front = device.foregroundPkg()
        if (front == policy.self) {
          perform(Action.Press(Button.BACK), null)
          front = device.foregroundPkg()
        }
        val now = observer.build(front) { device.read() }
        if (now == null || now.context.pkg != obs.context.pkg || targetOf(now, action) != target) {
          return "stale_screen: the screen changed while the owner decided, so nothing was done. Look again.".also { step(obs, what, "confirm", it) }
        }
        perform(action, target).also { step(obs, what, "confirm", it) }
      }
    }
  }

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
    return device.perform(action, target).also { device.settle() }
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
    else -> a::class.simpleName.orEmpty() + t?.label?.let { " \"$it\"" }.orEmpty()
  }

  private fun step(obs: Observation, action: String, verdict: String, result: String) =
    emit(RunEvent.Step(runId, guard.steps, obs.app, action, verdict, result, guard.costUsd))

  private fun declined() = end(RunStatus.DECLINED, "The owner said no, so Deputy stopped before that step.")

  private fun end(status: RunStatus, summary: String?): RunResult {
    emit(RunEvent.Finished(runId, status, summary, guard.costUsd))
    return RunResult(status, summary)
  }

  companion object {
    const val SHOT_WIDTH = 720 // screenshots reach the model at this width, so tap_at uses these pixels
    private const val WAITING = "waiting for the owner"
  }
}
