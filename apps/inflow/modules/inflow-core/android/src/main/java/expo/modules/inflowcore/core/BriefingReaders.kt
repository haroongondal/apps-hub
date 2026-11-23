package expo.modules.inflowcore.core

import java.time.LocalDate
import java.time.YearMonth
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class LinkTable(val columns: List<String>, val rows: List<List<Any?>>)

fun interface LinkResolver {
  fun query(uri: String): LinkTable?
}

object BriefingReaders {
  const val TIMEOUT_MS = 2_000L
  const val MAX_ROWS = 200
  const val MAX_TEXT = 200
  const val MAX_NAME = 12
  const val HOME_URI = "content://com.haroon.netlens.applink/who_is_home"
  const val CARDS_URI = "content://com.haroon.strongroom.applink/expiry"
  const val TASKS_URI = "content://com.haroon.deputy.applink/waiting"
  // Nexus has not built this share yet: the columns are the planned ones, and until it exists the reader finds nothing and adds no line.
  const val NEXUS_URI = "content://com.haroon.pdfeditor.applink/today"

  private enum class Col { LONG, LONG_OPT, TEXT }

  private class Reader(val uri: String, val columns: Map<String, Col>, val maxRows: Int, val line: (List<Map<String, Any?>>, LocalDate) -> AppLine?)

  private val READERS = listOf(
    Reader(HOME_URI, mapOf("person" to Col.TEXT, "present" to Col.LONG, "last_seen_at" to Col.LONG), 16) { rows, _ -> home(rows) },
    Reader(CARDS_URI, mapOf("kind" to Col.TEXT, "label" to Col.TEXT, "expires_on" to Col.TEXT, "days_left" to Col.LONG), 200, ::cards),
    Reader(TASKS_URI, mapOf("id" to Col.LONG, "label" to Col.TEXT, "due_at" to Col.LONG_OPT, "state" to Col.TEXT), 100) { rows, _ -> tasks(rows) },
    Reader(NEXUS_URI, mapOf("id" to Col.LONG, "title" to Col.TEXT, "due_at" to Col.LONG_OPT), 200) { rows, _ -> nexus(rows) },
  )

  fun lines(resolver: LinkResolver, owner: ProviderOwner, sameKey: SameKey, today: LocalDate, timeoutMs: Long = TIMEOUT_MS): List<AppLine> {
    val pool = Executors.newFixedThreadPool(READERS.size) { r -> Thread(r, "briefing-reader").apply { isDaemon = true } }
    try {
      val jobs = READERS.map { r ->
        r to pool.submit(Callable { if (SiblingIdentity.trusted(authority(r.uri), owner, sameKey)) resolver.query(r.uri) else null })
      }
      val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
      return jobs.mapNotNull { (r, job) ->
        runCatching { job.get(maxOf(0L, deadline - System.nanoTime()), TimeUnit.NANOSECONDS)?.let { t -> valid(t, r.columns, r.maxRows) }?.let { r.line(it, today) } }.getOrNull()
      }
    } finally {
      pool.shutdownNow()
    }
  }

  fun authority(uri: String): String = uri.removePrefix("content://").substringBefore('/')

  private fun valid(t: LinkTable, columns: Map<String, Col>, maxRows: Int): List<Map<String, Any?>>? {
    val at = columns.keys.associateWith { t.columns.indexOf(it) }
    if (at.values.any { it < 0 }) return null
    return t.rows.take(maxRows).mapNotNull { row ->
      if (row.size != t.columns.size) return@mapNotNull null
      columns.mapValues { (name, col) ->
        val v = row[at.getValue(name)]
        when (col) {
          Col.LONG -> v as? Long ?: return@mapNotNull null
          Col.LONG_OPT -> if (v == null) null else v as? Long ?: return@mapNotNull null
          Col.TEXT -> (v as? String)?.let { Briefing.clean(it, MAX_TEXT) }?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        }
      }
    }
  }

  fun home(rows: List<Map<String, Any?>>): AppLine? {
    val names = rows.filter { it["present"] == 1L && (it["last_seen_at"] as Long) >= 0 }.map { Briefing.clean(it["person"] as String, MAX_NAME) }.distinct()
    val text = when (names.size) {
      0 -> return null
      1 -> "${names[0]} is home"
      2 -> "${names[0]} and ${names[1]} are home"
      3 -> "${names[0]}, ${names[1]} and ${names[2]} are home"
      else -> "${names.size} people are home"
    }
    return AppLine(BriefingKind.HOME, text)
  }

  fun cards(rows: List<Map<String, Any?>>, today: LocalDate): AppLine? {
    val month = YearMonth.from(today)
    val n = rows.count { r ->
      val ends = runCatching { LocalDate.parse(r["expires_on"] as String) }.getOrNull()
      r["kind"] == "card" && ends != null && !ends.isBefore(today) && YearMonth.from(ends) == month
    }
    return when (n) {
      0 -> null
      1 -> AppLine(BriefingKind.CARDS, "1 card expires this month")
      else -> AppLine(BriefingKind.CARDS, "$n cards expire this month")
    }
  }

  // A scheduled run is not waiting for the owner; a run at its OK gate and a draft are.
  fun tasks(rows: List<Map<String, Any?>>): AppLine? {
    val n = rows.count { it["state"] == "waiting_for_ok" || it["state"] == "draft" }
    return when (n) {
      0 -> null
      1 -> AppLine(BriefingKind.TASKS, "1 task is waiting for you")
      else -> AppLine(BriefingKind.TASKS, "$n tasks are waiting for you")
    }
  }

  fun nexus(rows: List<Map<String, Any?>>): AppLine? {
    val n = rows.map { it["id"] }.distinct().size
    return when (n) {
      0 -> null
      1 -> AppLine(BriefingKind.NEXUS, "1 thing in Nexus today")
      else -> AppLine(BriefingKind.NEXUS, "$n things in Nexus today")
    }
  }
}
