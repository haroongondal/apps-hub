package expo.modules.deputyagent.core

import java.security.SecureRandom
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

enum class GateKind { CONFIRM, QUESTION }

data class Gate(
  val id: String,
  val runId: String,
  val kind: GateKind,
  val app: String,
  val action: String,
  val target: String?,
  val draftText: String?,
  val reason: String?,
  val options: List<String>,
  val expiresAt: Long,
)

data class Answer(val approved: Boolean, val text: String?)

/** Safety rule 5 (SPEC §8.3): one pending gate; its id is accepted once, only while its run waits and before it expires. */
class Gates(private val now: () -> Long) {
  private var waiting: Pair<Gate, CompletableDeferred<Answer>>? = null
  private val random = SecureRandom()

  @Synchronized
  fun open(
    runId: String,
    kind: GateKind,
    app: String,
    action: String,
    target: String? = null,
    draftText: String? = null,
    reason: String? = null,
    options: List<String> = emptyList(),
  ): Gate {
    waiting?.second?.cancel()
    val id = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    val gate = Gate(id, runId, kind, app, action, target, draftText?.let { if (it.length > 200) it.take(199) + "…" else it }, reason, options.take(3), now() + TIMEOUT_MS)
    waiting = gate to CompletableDeferred()
    return gate
  }

  @Synchronized
  fun pending(): Gate? = waiting?.takeIf { !it.second.isCompleted }?.first

  @Synchronized
  fun resolve(gateId: String, approve: Boolean, text: String?): Boolean {
    val (gate, answer) = waiting ?: return false
    if (gate.id != gateId || now() >= gate.expiresAt) return false
    // FR-7: a question's answer is text only and never counts as approval.
    return answer.complete(Answer(approved = approve && gate.kind == GateKind.CONFIRM, text = text))
  }

  suspend fun await(gate: Gate): Answer? {
    val answer = synchronized(this) { waiting?.takeIf { it.first.id == gate.id }?.second } ?: return null
    try {
      return withTimeoutOrNull(gate.expiresAt - now()) { answer.await() }
    } finally {
      synchronized(this) { if (waiting?.first?.id == gate.id) waiting = null }
    }
  }

  companion object {
    const val TIMEOUT_MS = 5 * 60_000L
  }
}
