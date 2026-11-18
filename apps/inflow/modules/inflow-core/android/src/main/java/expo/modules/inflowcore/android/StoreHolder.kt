package expo.modules.inflowcore.android

import android.content.Context
import android.provider.Telephony
import android.util.Log
import expo.modules.inflowcore.core.Ledger
import expo.modules.inflowcore.core.Ingest
import expo.modules.inflowcore.core.KEY_LOST_MESSAGE
import expo.modules.inflowcore.core.LedgerBackfill
import expo.modules.inflowcore.core.Sms
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** The one store the listener and the module share. A failed open is retried later unless the key is lost; the database file is never touched. */
object StoreHolder {
  @Volatile var onCaptured: ((Int) -> Unit)? = null

  private var opened: Result<SqlItemStore>? = null

  @Synchronized
  fun get(context: Context): Result<SqlItemStore> {
    opened?.let { if (it.isSuccess || it.exceptionOrNull()?.message == KEY_LOST_MESSAGE) return it }
    return SqlItemStore.open(context.applicationContext).also { opened = it }
  }

  fun storeError(context: Context): String? = get(context).exceptionOrNull()?.message

  const val OWNER_NAME = "ownerName"

  fun ledger(store: SqlItemStore) = Ledger(SqlLedgerStore(store.db)) { store.meta(OWNER_NAME)?.takeIf { it.isNotBlank() } }

  fun smsPackages(context: Context): Set<String> = Sms.KNOWN_APPS + listOfNotNull(Telephony.Sms.getDefaultSmsPackage(context))

  private var media: MediaStore? = null

  /** Null when the database key cannot be read: then no media is saved and the text still is. */
  @Synchronized
  fun media(context: Context, store: SqlItemStore): MediaStore? {
    media?.let { return it }
    val dbKey = DbKey.get(context.applicationContext, create = false) ?: return null
    val key = MediaStore.keyFor(dbKey)
    dbKey.fill(0)
    return MediaStore(File(context.filesDir, "media"), key, SqlMediaIndex(store)) { name, by -> store.bump(name, by) }.also { media = it }
  }

  fun ingest(context: Context, store: SqlItemStore, onOtpSaved: (Long) -> Unit = {}) =
    Ingest(
      store, context.packageName, System::currentTimeMillis, onOtpSaved, ledger(store), smsPackages(context), media(context, store),
      aiOn = { AiConfig(store).on() }, bump = store::bump,
    )

  private val backfilling = AtomicBoolean(false)

  /** R45: reads the saved messages the ledger has no source for, 100 at a time on the capture executor (never the JS thread). One run at a time; a failed run picks up at its cursor next time. */
  fun backfill(context: Context) {
    if (backfilling.compareAndSet(false, true)) InflowListener.executor.execute { backfillStep(context.applicationContext, null) }
  }

  private fun backfillStep(context: Context, started: LedgerBackfill?) {
    try {
      val store = get(context).getOrNull()
      if (store == null) {
        backfilling.set(false)
        return
      }
      val job = started ?: LedgerBackfill(SqlBackfillStore(store, smsPackages(context)), ledger(store), System::currentTimeMillis)
      if (job.runBatch()) {
        InflowListener.executor.execute { backfillStep(context, job) }   // a turn between batches for the notifications waiting behind it
        return
      }
      backfilling.set(false)
      if (job.linked > 0) onCaptured?.invoke(job.linked)
    } catch (e: Exception) {
      backfilling.set(false)
      Log.w("StoreHolder", "backfill failed: ${e.javaClass.simpleName}")
    }
  }
}
