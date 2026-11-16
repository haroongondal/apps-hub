package expo.modules.inflowcore.android

import android.content.Context
import android.provider.Telephony
import expo.modules.inflowcore.core.Ledger
import expo.modules.inflowcore.core.Ingest
import expo.modules.inflowcore.core.KEY_LOST_MESSAGE
import expo.modules.inflowcore.core.Sms
import java.io.File

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
    Ingest(store, context.packageName, System::currentTimeMillis, onOtpSaved, ledger(store), smsPackages(context), media(context, store)) { AiConfig(store).on() }
}
