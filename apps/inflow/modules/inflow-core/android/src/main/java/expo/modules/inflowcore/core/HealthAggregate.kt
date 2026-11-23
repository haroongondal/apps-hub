package expo.modules.inflowcore.core

import java.time.LocalDate
import java.time.ZoneId

data class HealthDay(val day: String, val steps: Long?, val sleepMinutes: Int?, val hrAvg: Int?, val hrLow: Int?)

fun HealthDay.toMap(): Map<String, Any?> =
  mapOf("day" to day, "steps" to steps, "sleepMinutes" to sleepMinutes, "hrAvg" to hrAvg, "hrLow" to hrLow)

data class DayWindow(val day: LocalDate, val startMs: Long, val endMs: Long)

data class HrSample(val atMs: Long, val bpm: Int)

data class SleepStage(val startMs: Long, val endMs: Long, val asleep: Boolean)

data class SleepSession(val startMs: Long, val endMs: Long, val stages: List<SleepStage>)

interface HealthStore {
  fun replaceDays(first: String, last: String, rows: List<HealthDay>, keepFrom: String, now: Long)

  fun days(from: String, to: String): List<HealthDay>
}

object HealthAggregate {
  const val DEFAULT_DAYS = 30
  const val MAX_DAYS = 90
  const val KEEP_DAYS = 400L
  const val LOW_WINDOW_MS = 5 * 60_000L
  const val LOW_MIN_SAMPLES = 2

  fun windows(today: LocalDate, days: Int, zone: ZoneId): List<DayWindow> =
    (days.coerceIn(1, MAX_DAYS) - 1 downTo 0).map { back ->
      val d = today.minusDays(back.toLong())
      DayWindow(d, d.atStartOfDay(zone).toInstant().toEpochMilli(), d.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli())
    }

  fun windowAt(windows: List<DayWindow>, t: Long): DayWindow? {
    val i = windows.binarySearch { w -> if (t < w.startMs) 1 else if (t >= w.endMs) -1 else 0 }
    return if (i >= 0) windows[i] else null
  }

  // Rule: sessions that overlap or touch form one night, which belongs to the day it ends on (start < end <= day end) and is never split at midnight; asleep time is the union of asleep stages (or whole sessions without stages), so nothing counts twice.
  fun sleepMinutes(sessions: List<SleepSession>, windows: List<DayWindow>): Map<LocalDate, Int> {
    val nights = mutableListOf<MutableList<SleepSession>>()
    var nightEnd = Long.MIN_VALUE
    for (s in sessions.filter { it.endMs > it.startMs }.sortedBy { it.startMs }) {
      if (nights.isEmpty() || s.startMs > nightEnd) {
        nights += mutableListOf(s)
        nightEnd = s.endMs
      } else {
        nights.last() += s
        nightEnd = maxOf(nightEnd, s.endMs)
      }
    }
    val ms = mutableMapOf<LocalDate, Long>()
    for (night in nights) {
      val end = night.maxOf { it.endMs }
      val day = windows.firstOrNull { end > it.startMs && end <= it.endMs }?.day ?: continue
      ms[day] = (ms[day] ?: 0L) + unionMs(night.flatMap(::asleepParts))
    }
    return ms.mapValues { (_, v) -> ((v + 30_000L) / 60_000L).toInt() }
  }

  private fun asleepParts(s: SleepSession): List<Pair<Long, Long>> =
    if (s.stages.isEmpty()) listOf(s.startMs to s.endMs)
    else s.stages.filter { it.asleep }.map { maxOf(it.startMs, s.startMs) to minOf(it.endMs, s.endMs) }.filter { it.second > it.first }

  private fun unionMs(parts: List<Pair<Long, Long>>): Long {
    var total = 0L
    var curStart = 0L
    var curEnd = Long.MIN_VALUE
    for ((a, b) in parts.sortedBy { it.first }) {
      if (a > curEnd) {
        if (curEnd != Long.MIN_VALUE) total += curEnd - curStart
        curStart = a
        curEnd = b
      } else if (b > curEnd) curEnd = b
    }
    if (curEnd != Long.MIN_VALUE) total += curEnd - curStart
    return total
  }

  // Rule: the day's lowest average over any 5-minute stretch [t, t + 5 min) that starts at a sample and holds at least 2 samples of that day; identical samples count once; a plain low point, not a medical measure.
  fun hrLow(samples: List<HrSample>, windows: List<DayWindow>): Map<LocalDate, Int> {
    val byDay = samples.filter { it.bpm > 0 }.distinct().sortedBy { it.atMs }.groupBy { windowAt(windows, it.atMs)?.day }
    val out = mutableMapOf<LocalDate, Int>()
    for ((day, list) in byDay) {
      if (day == null) continue
      val prefix = LongArray(list.size + 1).also { p -> list.forEachIndexed { i, s -> p[i + 1] = p[i] + s.bpm } }
      var lowest = Double.MAX_VALUE
      var j = 0
      for (i in list.indices) {
        while (j < list.size && list[j].atMs < list[i].atMs + LOW_WINDOW_MS) j++
        val n = j - i
        if (n >= LOW_MIN_SAMPLES) lowest = minOf(lowest, (prefix[j] - prefix[i]).toDouble() / n)
      }
      if (lowest != Double.MAX_VALUE) out[day] = Math.round(lowest).toInt()
    }
    return out
  }

  fun days(
    windows: List<DayWindow>,
    steps: Map<LocalDate, Long>,
    hrAvg: Map<LocalDate, Long>,
    hrSamples: List<HrSample>,
    sleep: List<SleepSession>,
  ): List<HealthDay> {
    val nights = sleepMinutes(sleep, windows)
    val lows = hrLow(hrSamples, windows)
    return windows.mapNotNull { w ->
      val row = HealthDay(w.day.toString(), steps[w.day], nights[w.day], hrAvg[w.day]?.toInt(), lows[w.day])
      if (row.steps == null && row.sleepMinutes == null && row.hrAvg == null && row.hrLow == null) null else row
    }
  }

  fun save(store: HealthStore, windows: List<DayWindow>, rows: List<HealthDay>, now: Long) {
    val last = windows.last().day
    store.replaceDays(windows.first().day.toString(), last.toString(), rows, last.minusDays(KEEP_DAYS - 1).toString(), now)
  }
}
