package expo.modules.noteboxcore.android

import android.content.Context
import expo.modules.noteboxcore.core.Ingest
import expo.modules.noteboxcore.core.KEY_LOST_MESSAGE

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

  fun ingest(context: Context, store: SqlItemStore, onOtpSaved: (Long) -> Unit = {}) =
    Ingest(store, context.packageName, System::currentTimeMillis, onOtpSaved)
}
