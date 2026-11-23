package expo.modules.nexuslinks.core

import expo.modules.nexuslinks.applink.SiblingPackages
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit

object Readers {
  const val OK = "ok"
  const val MISSING = "missing"
  const val REFUSED = "refused"
  const val FAILED = "failed"

  const val TIMEOUT_MS = 3000L
  const val MAX_TEXT = 8000
  const val MAX_SAFE_LONG = 9007199254740991L
  private const val INT32_MAX = 2147483647L

  enum class Type(val nullable: Boolean) { LONG(false), INT(false), DOUBLE(false), STRING(false), LONG_N(true), INT_N(true), DOUBLE_N(true), STRING_N(true) }

  data class Spec(val authority: String, val path: String, val columns: List<Pair<String, Type>>, val maxRows: Int, val pkg: String, val paged: Boolean, val strict: Boolean)

  private const val INFLOW = "com.haroon.inflow.autopilot"
  private fun cols(vararg c: Pair<String, Type>) = c.toList()

  val SPECS: Map<String, Spec> = linkedMapOf(
    "inflow.ask_items" to Spec(INFLOW, "ask_items", cols("id" to Type.LONG, "app" to Type.STRING, "sender" to Type.STRING_N, "text" to Type.STRING, "at" to Type.LONG), 200, SiblingPackages.INFLOW, paged = true, strict = false),
    "inflow.ask_ids" to Spec(INFLOW, "ask_ids", cols("id" to Type.LONG), 200, SiblingPackages.INFLOW, paged = true, strict = true),
    "inflow.debits" to Spec(INFLOW, "debits", cols("id" to Type.LONG, "amount_minor" to Type.LONG, "at" to Type.LONG, "merchant" to Type.STRING, "account" to Type.STRING), 200, SiblingPackages.INFLOW, paged = true, strict = false),
    "deputy.runs" to Spec("com.haroon.deputy.applink", "runs", cols("id" to Type.LONG, "task" to Type.STRING, "state" to Type.STRING, "finished_at" to Type.LONG), 200, SiblingPackages.DEPUTY, paged = false, strict = true),
    "clipboard.pinned" to Spec("com.haroon.clipboard.applink", "pinned", cols("id" to Type.LONG, "text" to Type.STRING, "pinned_at" to Type.LONG, "from_app" to Type.STRING), 200, SiblingPackages.CLIPBOARD, paged = true, strict = true),
  )

  data class Plan(val spec: Spec, val uri: String)

  fun plan(id: String, sinceId: Double?): Plan? {
    val spec = SPECS[id] ?: return null
    if (!spec.paged) return if (sinceId == null) Plan(spec, "content://${spec.authority}/${spec.path}") else null
    val since = sinceId ?: 0.0
    if (!since.isFinite() || since != Math.floor(since) || since < 0 || since > MAX_SAFE_LONG.toDouble()) return null
    return Plan(spec, "content://${spec.authority}/${spec.path}/${since.toLong()}")
  }

  // A missing column fails the read: dropping every row instead would look like an empty snapshot and wipe what Nexus kept.
  fun columnIndexes(spec: Spec, cursorColumns: List<String>): List<Int>? =
    spec.columns.map { (name, _) -> cursorColumns.indexOf(name).takeIf { it >= 0 } ?: return null }

  // Null fails the read. Ruling R11: a strict read (snapshot or id list) with one bad row, or more than maxRows rows, fails whole,
  // because a shorter list would delete kept items; an item read just skips bad rows and keeps the first maxRows.
  fun rows(spec: Spec, raw: List<List<Any?>>): List<Map<String, Any?>>? {
    val kept = raw.take(spec.maxRows).mapNotNull { row(spec, it) }
    return if (spec.strict && kept.size != raw.size) null else kept
  }

  fun row(spec: Spec, values: List<Any?>): Map<String, Any?>? {
    if (values.size != spec.columns.size) return null
    val out = LinkedHashMap<String, Any?>()
    for ((i, column) in spec.columns.withIndex()) {
      val (name, type) = column
      val v = coerce(type, values[i])
      if (v == null && !(values[i] == null && type.nullable)) return null
      if (name == "id" && (v as Long) <= 0) return null
      out[name] = v
    }
    return out
  }

  private fun coerce(type: Type, v: Any?): Any? = when (type) {
    Type.LONG, Type.LONG_N -> whole(v)?.takeIf { it in -MAX_SAFE_LONG..MAX_SAFE_LONG }
    Type.INT, Type.INT_N -> whole(v)?.takeIf { it in -INT32_MAX..INT32_MAX }
    Type.DOUBLE, Type.DOUBLE_N -> (v as? Number)?.toDouble()?.takeIf { it.isFinite() }
    Type.STRING, Type.STRING_N -> (v as? String)?.takeIf { it.length <= MAX_TEXT }
  }

  private fun whole(v: Any?): Long? = when (v) {
    is Long -> v
    is Int -> v.toLong()
    is Double -> v.takeIf { it.isFinite() && it == Math.floor(it) && Math.abs(it) <= MAX_SAFE_LONG }?.toLong()
    else -> null
  }

  // A null cursor (provider not resolvable) is MISSING and is decided by the caller; a timeout is FAILED, never partial rows.
  fun statusOf(error: Throwable): String =
    if ((if (error is ExecutionException) error.cause else error) is SecurityException) REFUSED else FAILED

  fun answer(status: String, rows: List<Map<String, Any?>> = emptyList()): Map<String, Any?> = mapOf("status" to status, "rows" to rows)

  fun timed(pool: ExecutorService, timeoutMs: Long, cancel: () -> Unit, query: () -> Map<String, Any?>): Map<String, Any?> {
    val task = try {
      pool.submit<Map<String, Any?>> { query() }
    } catch (e: Exception) {
      return answer(FAILED)
    }
    return try {
      task.get(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {
      cancel()
      task.cancel(true)
      answer(statusOf(e))
    }
  }
}
