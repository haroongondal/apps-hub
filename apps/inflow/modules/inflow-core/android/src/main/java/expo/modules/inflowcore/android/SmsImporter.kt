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
  private const val LAST_SMS_DATE = "lastSmsDate"
  private const val BATCH = 100
  private const val FALLBACK_SMS_PKG = "com.android.mms"

  fun granted(context: Context): Boolean =
    listOf(Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS)
      .all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

  fun defaultPkg(context: Context): String = Telephony.Sms.getDefaultSmsPackage(context) ?: FALLBACK_SMS_PKG

  private class Row(val id: Long, val date: Long, val sms: RawSms?)

  /**
   * New inbox rows, 100 per transaction so a big inbox neither blocks the caller's thread for long nor holds one giant write.
   * Pass 1 re-reads rows whose provider _id is not above lastSmsId but whose date is newer than lastSmsDate (a reused _id);
   * pass 2 reads _id above lastSmsId. Rows read twice are dropped by the sms hash. Returns how many items it saved.
   */
  @Synchronized
  fun sync(context: Context): Int {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return 0
    val store = StoreHolder.get(context).getOrNull() ?: return 0
    val ingest = StoreHolder.ingest(context, store) { InflowListener.schedulePurge(context, it) }
    val pkg = defaultPkg(context)
    val label = InflowListener.label(context, pkg)
    val startId = store.meta(LAST_SMS_ID)?.toLongOrNull() ?: 0L
    val startDate = store.meta(LAST_SMS_DATE)?.toLongOrNull() ?: 0L
    var maxDate = startDate
    var saved = 0
    for (pass in 1..2) {
      var after = if (pass == 1) 0L else startId
      while (true) {
        val rows = if (pass == 1) readBatch(context, "_id <= ? AND date > ?", arrayOf(startId.toString(), startDate.toString()), after)
        else readBatch(context, "1 = 1", emptyArray(), after)
        if (rows.isEmpty()) break
        after = rows.last().id
        maxDate = maxOf(maxDate, rows.maxOf { it.date })
        saved += store.inTransaction {
          var n = 0
          for (r in rows) r.sms?.let { n += ingest.onSms(it, pkg, label) }
          if (pass == 2) store.setMeta(LAST_SMS_ID, after.toString())
          n
        }
        if (rows.size < BATCH) break
      }
    }
    if (maxDate > startDate) store.setMeta(LAST_SMS_DATE, maxDate.toString())
    return saved
  }

  // A row with a blank address or body keeps its id (so the cursor moves on) but has no RawSms.
  private fun readBatch(context: Context, where: String, args: Array<String>, afterId: Long): List<Row> {
    val out = ArrayList<Row>(BATCH)
    try {
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf("_id", "address", "body", "date", "date_sent"),
        "($where) AND _id > ?", args + afterId.toString(), "_id ASC",
      )?.use { c ->
        while (out.size < BATCH && c.moveToNext()) {
          val address = c.getString(1)
          val body = c.getString(2)
          val date = c.getLong(3)
          val sent = c.getLong(4).takeIf { it > 0 } ?: date
          out += Row(c.getLong(0), date, if (address.isNullOrBlank() || body.isNullOrBlank()) null else RawSms(address, body, sent, date))
        }
      }
    } catch (e: SecurityException) {
      Log.w(TAG, "inbox read refused")
    }
    return out
  }
}
