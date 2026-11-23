package expo.modules.strongroomvault.android

import android.content.Context
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.ExpiryIndex
import expo.modules.strongroomvault.core.ExpiryItem

// The expiry share's only data: kind, label and date per card, sealed with the device key so a sibling app can read it while
// the vault is locked. Off by default; turning it off deletes the file.
internal object ExpiryShare {
  internal const val ON = "expiryShare"
  internal const val NAMES = "expiryShareNames"
  private const val FILE = "expiry.bin"
  private val lock = Any()

  fun enabled(context: Context) = VaultHolder.prefs(context).getBoolean(ON, false)

  fun names(context: Context) = VaultHolder.prefs(context).getBoolean(NAMES, false)

  fun set(context: Context, on: Boolean, names: Boolean, entries: () -> Map<String, Entry>) {
    VaultHolder.prefs(context).edit().putBoolean(ON, on).putBoolean(NAMES, names).commit()
    if (on) refresh(context, entries) else delete(context)
  }

  fun refresh(context: Context, entries: () -> Map<String, Entry>) {
    if (!enabled(context)) return delete(context)
    synchronized(lock) {
      val f = VaultHolder.file(context, FILE)
      try {
        with(VaultHolder) { f.write(DeviceKey.seal(ExpiryIndex.encode(ExpiryIndex.build(entries(), names(context))))) }
      } catch (e: Exception) {
        f.delete() // a stale index could still list a removed card; empty until the next unlock or change
      }
    }
  }

  fun delete(context: Context) = synchronized(lock) { VaultHolder.file(context, FILE).delete() }

  fun read(context: Context): List<ExpiryItem> = readIf(enabled(context)) {
    val sealed = synchronized(lock) { with(VaultHolder) { file(context, FILE).readOrNull() } } ?: return@readIf emptyList()
    ExpiryIndex.decode(DeviceKey.open(sealed))
  }

  internal fun readIf(enabled: Boolean, load: () -> List<ExpiryItem>): List<ExpiryItem> = if (enabled) load() else emptyList()
}
