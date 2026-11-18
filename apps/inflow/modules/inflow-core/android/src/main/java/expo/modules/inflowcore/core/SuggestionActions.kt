package expo.modules.inflowcore.core

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

/** What Run does for one suggestion. The Android side only carries it out. */
sealed interface RunPlan {
  data class Refuse(val message: String) : RunPlan
  data class OpenCalendar(val title: String, val startAt: Long, val alarmBefore: Boolean) : RunPlan
  data class Remind(val at: Long) : RunPlan
  data object AskDeputy : RunPlan
  /** Null opens the transaction in Inflow itself. */
  data class OpenApp(val pkg: String?) : RunPlan
}

object SuggestionActions {
  const val GONE = "That suggestion already ran or expired."
  private const val MINUTE_MS = 60_000L

  fun plan(s: Suggestion, now: Long, zone: ZoneId, deputyInstalled: Boolean, settings: AutopilotSettings): RunPlan {
    if (!s.state.canRun() || s.expiresAt <= now) return RunPlan.Refuse(GONE)   // expired between posting and the tap
    return when (s.kind) {
      // The row holds no detail, so the calendar title is the plain word; the owner adds the rest.
      SuggestionKind.EVENT -> s.dueAt?.let { RunPlan.OpenCalendar("Meeting", it, settings.alarmBefore) } ?: RunPlan.Refuse("That meeting has no time to put in the calendar.")
      SuggestionKind.BILL -> RunPlan.Remind(billReminderAt(s.dueAt, now, zone))
      SuggestionKind.REPLY -> if (deputyInstalled) RunPlan.AskDeputy else RunPlan.Refuse("Deputy isn't installed.")
      SuggestionKind.MONEY -> RunPlan.OpenApp(settings.bankApp)
    }
  }

  /** 08:00 on the due day, or a minute from now when that has passed (or there is no due time). */
  private fun billReminderAt(dueAt: Long?, now: Long, zone: ZoneId): Long {
    val eight = dueAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate().atTime(LocalTime.of(8, 0)).atZone(zone).toInstant().toEpochMilli() }
    return if (eight != null && eight > now) eight else now + MINUTE_MS
  }
}

/** Tells the Android side about each suggestion that was really stored (a duplicate is not announced). */
class NotifyingSuggestionStore(private val inner: SuggestionStore, private val onAdded: (Suggestion) -> Unit) : SuggestionStore by inner {
  override fun add(s: Suggestion): Long? = inner.add(s)?.also { id -> runCatching { onAdded(s.copy(id = id)) } }
}
