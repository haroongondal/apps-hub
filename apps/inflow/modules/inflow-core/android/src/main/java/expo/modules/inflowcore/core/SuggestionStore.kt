package expo.modules.inflowcore.core

import java.time.ZoneId

/** Meta key of the stored AutopilotSettings JSON. */
const val AUTOPILOT_META = "autopilotSettings"

interface SuggestionStore {
  /** The new row id; null when a WAITING or STARTED suggestion with the same dedupeKey exists. A finished one does not block. */
  fun add(s: Suggestion): Long?
  /** Newest first. */
  fun waiting(): List<Suggestion>
  /** Newest first. */
  fun list(states: Set<SuggestionState>, limit: Int): List<Suggestion>
  fun get(id: Long): Suggestion?
  /** False for an unknown id or a move [canMoveTo] refuses. */
  fun setState(id: Long, state: SuggestionState, now: Long): Boolean
  /** WAITING and STARTED rows with expiresAt <= now become EXPIRED (Deputy writes DONE only on a clean finish). Returns the count. */
  fun expire(now: Long): Int
  /** The owner wrote in this chat of this app: its WAITING replies (dedupeKey [SuggestionRules.replyKey]) become EXPIRED. Returns the count. */
  fun closeReplies(pkg: String, conversationKey: String, now: Long): Int
}

/** The states a row may be in for it to move to this one: WAITING starts (STARTED needs a WAITING row, so a second Run finds none) and DONE, SKIPPED and EXPIRED are final. */
fun SuggestionState.movableFrom(): Set<SuggestionState> = when (this) {
  SuggestionState.WAITING -> emptySet()
  SuggestionState.STARTED -> setOf(SuggestionState.WAITING)
  else -> setOf(SuggestionState.WAITING, SuggestionState.STARTED)
}

/** What AiRun calls for each saved result: at most one suggestion, only for a kind the owner switched on. Settings are read per call. */
fun suggestionHook(
  store: SuggestionStore, settings: () -> AutopilotSettings, now: () -> Long, zone: ZoneId,
  hasOwnAfter: (pkg: String, conversationKey: String, at: Long) -> Boolean = { _, _, _ -> false },
): (AiResult, AiInput) -> Unit = { r, input ->
  // A reply is moot when the owner already wrote in that chat after the message.
  val answered = r.suggest?.type == SuggestType.REPLY && input.pkg != null && input.conversationKey != null && hasOwnAfter(input.pkg, input.conversationKey, input.at)
  if (!answered) SuggestionRules.fromResult(r, input, input.conversationKey, now(), zone, settings())?.let { store.add(it) }
}

/**
 * The one way a suggestion changes state from outside (the provider, Inflow's Run). Only a start sweeps expired rows first, so a
 * suggestion past its time can never start; a late done or skip of a row already started or waiting still lands (R6 ruling).
 */
object SuggestionMoves {
  fun move(store: SuggestionStore, id: Long, to: SuggestionState, now: Long): Boolean {
    if (to == SuggestionState.STARTED) store.expire(now)
    return store.setState(id, to, now)
  }
}
