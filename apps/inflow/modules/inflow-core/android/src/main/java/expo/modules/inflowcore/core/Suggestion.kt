package expo.modules.inflowcore.core

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class SuggestionKind { REPLY, BILL, EVENT, MONEY }

enum class SuggestionState { WAITING, STARTED, DONE, SKIPPED, EXPIRED }

data class Suggestion(
  val id: Long,
  val kind: SuggestionKind,
  val title: String,
  val itemId: Long,
  val dueAt: Long?,
  val dedupeKey: String,
  val state: SuggestionState,
  val createdAt: Long,
  val updatedAt: Long,
  val expiresAt: Long,
)

/** Run is allowed once: a started, done, skipped or expired suggestion never runs again. */
fun SuggestionState.canRun(): Boolean = this == SuggestionState.WAITING

/** Titles come from code (kind, a name, a date), never from model text. */
object SuggestionTitle {
  private const val NAME_MAX = 40
  private val DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
  private val CLOCK = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH)

  // An event title always carries its date: it is stored, and "tomorrow" would be wrong by the next morning. `now` is kept so callers need not change.
  @Suppress("UNUSED_PARAMETER")
  fun of(kind: SuggestionKind, name: String?, dueAt: Long?, now: Long, zone: ZoneId, moneyIn: Boolean = false): String {
    val who = clean(name)
    return when (kind) {
      SuggestionKind.REPLY -> if (who == null) "Reply in a chat" else "Reply to $who"
      SuggestionKind.BILL -> if (dueAt == null) "Bill due soon" else "Bill due ${DAY.format(local(dueAt, zone))}"
      SuggestionKind.EVENT -> if (dueAt == null) "Meeting soon" else "Meeting ${CLOCK.format(local(dueAt, zone))} on ${DAY.format(local(dueAt, zone))}"
      SuggestionKind.MONEY -> when {
        moneyIn -> if (who == null) "Money in from someone new" else "Money in from $who"
        who == null -> "Unusual payment"
        else -> "Large debit at $who"
      }
    }
  }

  /** Whitespace (newlines too) collapsed to single spaces, cut to 40 characters; blank is null. */
  private fun clean(name: String?): String? =
    name?.trim()?.replace(Regex("\\s+"), " ")?.take(NAME_MAX)?.trim()?.takeIf { it.isNotEmpty() }

  private fun local(ms: Long, zone: ZoneId) = Instant.ofEpochMilli(ms).atZone(zone)
}

private const val HOUR_MS = 3_600_000L
private const val DAY_MS = 24 * HOUR_MS

/** When a suggestion stops being offered: reply 24 h after creation, event at its time, bill 3 days after due, money 7 days. A bill or event without a time falls back to 7 days. */
fun expiryFor(kind: SuggestionKind, createdAt: Long, dueAt: Long?): Long = when (kind) {
  SuggestionKind.REPLY -> createdAt + DAY_MS
  SuggestionKind.EVENT -> dueAt ?: (createdAt + 7 * DAY_MS)
  SuggestionKind.BILL -> dueAt?.plus(3 * DAY_MS) ?: (createdAt + 7 * DAY_MS)
  SuggestionKind.MONEY -> createdAt + 7 * DAY_MS
}
