package expo.modules.nexuslinks.android

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.CancellationSignal
import expo.modules.nexuslinks.applink.AppLinkTarget
import expo.modules.nexuslinks.core.Readers
import expo.modules.nexuslinks.core.Readers.answer
import java.util.concurrent.Executors

class LinkReader(private val context: Context) {
  // Two threads: a provider stuck in a binder call can hold at most both, and later reads then time out instead of piling up.
  private val pool = Executors.newFixedThreadPool(2)

  fun read(id: String, sinceId: Double?): Map<String, Any?> {
    val plan = Readers.plan(id, sinceId) ?: return answer(Readers.FAILED)
    val signal = CancellationSignal()
    return Readers.timed(pool, Readers.TIMEOUT_MS, signal::cancel) { query(plan, signal) }
  }

  private fun query(plan: Readers.Plan, signal: CancellationSignal): Map<String, Any?> {
    // Checked before every query: another app can claim the authority, or the sibling can be replaced while Nexus runs.
    if (!AppLinkTarget.trustedProvider(context, plan.spec.authority, plan.spec.pkg)) return answer(Readers.MISSING)
    val cursor = context.contentResolver.query(Uri.parse(plan.uri), null, null, null, null, signal) ?: return answer(Readers.MISSING)
    return cursor.use { c ->
      val indexes = Readers.columnIndexes(plan.spec, c.columnNames.toList()) ?: return answer(Readers.FAILED)
      val raw = ArrayList<List<Any?>>()
      while (raw.size <= plan.spec.maxRows && c.moveToNext()) {
        signal.throwIfCanceled()
        raw.add(indexes.map { value(c, it) })
      }
      Readers.rows(plan.spec, raw)?.let { answer(Readers.OK, it) } ?: answer(Readers.FAILED)
    }
  }

  private fun value(c: Cursor, i: Int): Any? = when (c.getType(i)) {
    Cursor.FIELD_TYPE_NULL -> null
    Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
    Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
    Cursor.FIELD_TYPE_STRING -> c.getString(i)
    else -> Unit // a blob fits no column type, so the row is dropped
  }

  fun close() {
    pool.shutdownNow()
  }
}
