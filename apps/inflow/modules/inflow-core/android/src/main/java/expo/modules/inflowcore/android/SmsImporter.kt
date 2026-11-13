package expo.modules.inflowcore.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.inflowcore.core.RawSms

object SmsImporter {
  private const val TAG = "SmsImporter"
  private const val LAST_SMS_ID = "lastSmsId"
  private const val BATCH = 500
  private const val FALLBACK_SMS_PKG = "com.android.mms"

  fun granted(context: Context): Boolean =
    listOf(Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS)
      .all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

  fun defaultPkg(context: Context): String = Telephony.Sms.getDefaultSmsPackage(context) ?: FALLBACK_SMS_PKG

  /** Inbox rows newer than meta lastSmsId, 500 per transaction so a big inbox neither blocks the caller's thread for long nor holds one giant write. Returns how many items it saved. */
  @Synchronized
  fun sync(context: Context): Int {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return 0
    val store = StoreHolder.get(context).getOrNull() ?: return 0
    val ingest = StoreHolder.ingest(context, store) { InflowListener.schedulePurge(context, it) }
    val pkg = defaultPkg(context)
    val label = InflowListener.label(context, pkg)
    var last = store.meta(LAST_SMS_ID)?.toLongOrNull() ?: 0L
    var saved = 0
    while (true) {
      val rows = readBatch(context, last)
      if (rows.isEmpty()) break
      val newest = rows.last().first
      saved += store.inTransaction {
        var n = 0
        for ((_, sms) in rows) if (sms != null) n += ingest.onSms(sms, pkg, label)
        store.setMeta(LAST_SMS_ID, newest.toString())
        n
      }
      last = newest
      if (rows.size < BATCH) break
    }
    return saved
  }

  // A row with a blank address or body keeps its id (so the cursor moves on) but has no RawSms.
  private fun readBatch(context: Context, afterId: Long): List<Pair<Long, RawSms?>> {
    val out = ArrayList<Pair<Long, RawSms?>>(BATCH)
    try {
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf("_id", "address", "body", "date", "date_sent"),
        "_id > ?", arrayOf(afterId.toString()), "_id ASC",
      )?.use { c ->
        while (out.size < BATCH && c.moveToNext()) {
          val address = c.getString(1)
          val body = c.getString(2)
          val date = c.getLong(3)
          val sent = c.getLong(4).takeIf { it > 0 } ?: date
          out += c.getLong(0) to if (address.isNullOrBlank() || body.isNullOrBlank()) null else RawSms(address, body, sent, date)
        }
      }
    } catch (e: SecurityException) {
      Log.w(TAG, "inbox read refused")
    }
    return out
  }
}
