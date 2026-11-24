package expo.modules.deputyagent.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

data class Schedule(
  val id: String,
  val name: String,
  val task: String,
  val hour: Int,
  val minute: Int,
  val days: Set<DayOfWeek>,
  val enabled: Boolean,
  val createdAt: Long,
) {
  init {
    require(name.isNotBlank() && name.length <= 60) { "Give the task a name of up to 60 characters." }
    require(task.isNotBlank()) { "Type what the task should do." }
    require(hour in 0..23 && minute in 0..59) { "Pick a time between 00:00 and 23:59." }
    require(days.isNotEmpty()) { "Pick at least one day." }
  }

  // DST: a skipped local time runs an hour later; a doubled one runs once, at the first, since the result is after `now`.
  fun nextRun(now: Instant, zone: ZoneId): Instant? {
    if (!enabled) return null
    val today = now.atZone(zone).toLocalDate()
    return (0..7L).asSequence().map(today::plusDays).filter { it.dayOfWeek in days }
      .map { ZonedDateTime.of(it, LocalTime.of(hour, minute), zone).toInstant() }
      .first { it > now }
  }

  companion object {
    fun toJson(list: List<Schedule>): String = JsonArray(
      list.map { s ->
        buildJsonObject {
          put("id", s.id); put("name", s.name); put("task", s.task); put("hour", s.hour); put("minute", s.minute)
          put("days", JsonArray(s.days.sorted().map { JsonPrimitive(it.value) })); put("enabled", s.enabled); put("createdAt", s.createdAt)
        }
      },
    ).toString()

    fun fromJson(json: String): List<Schedule> = runCatching { Json.parseToJsonElement(json).jsonArray }.getOrNull().orEmpty().mapNotNull { e ->
      runCatching {
        val o = e.jsonObject
        Schedule(
          o["id"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content, o["task"]!!.jsonPrimitive.content,
          o["hour"]!!.jsonPrimitive.int, o["minute"]!!.jsonPrimitive.int,
          o["days"]!!.jsonArray.map { DayOfWeek.of(it.jsonPrimitive.int) }.toSet(),
          o["enabled"]!!.jsonPrimitive.boolean, o["createdAt"]!!.jsonPrimitive.long,
        )
      }.getOrNull()
    }
  }
}

enum class Outcome { RUNNING, WAITING, FINISHED, STOPPED, FAILED, SKIPPED;

  companion object {
    fun of(status: RunStatus) = when (status) {
      RunStatus.DONE -> FINISHED
      RunStatus.STOPPED, RunStatus.DECLINED, RunStatus.CAPPED -> STOPPED
      RunStatus.FAILED, RunStatus.INTERRUPTED -> FAILED
    }
  }
}

data class ScheduleRun(val at: Long, val outcome: Outcome, val summary: String, val runId: String?)

object ScheduledRun {
  // Owner's decision pending: false refuses repeating tasks that read like a payment; true lets them run up to the gate.
  const val PAYMENTS_ALLOWED = true

  const val LATE_MS = 30 * 60_000L

  const val CANT_START = "Deputy couldn't start this task."
  const val NO_PAYMENTS = "Repeating tasks can't pay for anything. Run this task yourself when you need it."
  private val MONEY = Regex("\\b(pay|pays|paying|payment|payments|transfer|send money|buy|purchase|order|checkout|recharge|top up)\\b", RegexOption.IGNORE_CASE)
  private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

  fun paymentRefusal(task: String, allowed: Boolean = PAYMENTS_ALLOWED): String? = if (allowed || !MONEY.containsMatchIn(task)) null else NO_PAYMENTS

  fun blocker(serviceOn: Boolean, keySet: Boolean, busy: Boolean, unlocked: Boolean): String? = when {
    !serviceOn -> "The Deputy accessibility service was off. Open Deputy and turn it on in Setup."
    !keySet -> "No API key was saved. Open Deputy and add one in Settings."
    busy -> "Deputy was busy with another task, so it didn't start this one."
    !unlocked -> "Your phone was locked. Unlock it and tap Run now."
    else -> null
  }

  fun begin(
    s: Schedule,
    dueAt: Long,
    now: Long,
    zone: ZoneId,
    blocker: String?,
    allowPayments: Boolean = PAYMENTS_ALLOWED,
    start: (task: String, apps: Set<String>?, untrusted: List<String>) -> String,
  ): Begin {
    if (now - dueAt > LATE_MS) {
      return Begin.Failed("Your phone was off or asleep at ${HHMM.format(Instant.ofEpochMilli(dueAt).atZone(zone))}, so Deputy skipped this one.")
    }
    paymentRefusal(s.task, allowPayments)?.let { return Begin.Failed(it) }
    blocker?.let { return Begin.Failed(it) }
    return try {
      Begin.Started(start(s.task, null, emptyList()))
    } catch (e: Exception) {
      Begin.Failed(e.message ?: CANT_START)
    }
  }
}
