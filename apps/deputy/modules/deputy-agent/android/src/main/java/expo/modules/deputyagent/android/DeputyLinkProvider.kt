package expo.modules.deputyagent.android

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Binder
import android.provider.Settings
import expo.modules.deputyagent.applink.AppLinkCaller
import expo.modules.deputyagent.core.LinkRows
import expo.modules.deputyagent.core.RunStore
import expo.modules.deputyagent.core.ServiceSetting
import java.io.File
import java.time.Instant
import java.time.ZoneId

/** Deputy's read-only shares for its signed sibling apps: `health` always, `waiting` and `runs` only while the owner's switch is on. */
class DeputyLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val c = context ?: throw SecurityException("Not a signed sibling app")
    if (!AppLinkCaller.allowed(c)) throw SecurityException("Not a signed sibling app")
    val callerPackages = c.packageManager.getPackagesForUid(Binder.getCallingUid())?.toList().orEmpty()
    if (uri.authority != LinkRows.AUTHORITY) throw IllegalArgumentException("Unknown share")
    return when (uri.pathSegments) {
      listOf("health") -> cursor(LinkRows.HEALTH_COLUMNS, listOf(health(c)))
      listOf("waiting") -> cursor(LinkRows.WAITING_COLUMNS, if (OwnerStore.linkShares(c)["waiting"] == true) waiting(c) else emptyList())
      listOf("runs") -> cursor(LinkRows.RUNS_COLUMNS, if (OwnerStore.linkShares(c)["runs"] == true && LinkRows.runsReader(callerPackages)) runs(c) else emptyList())
      else -> throw IllegalArgumentException("Unknown share")
    }
  }

  private fun health(c: Context): Array<Any?> {
    val enabled = Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
    val on = ServiceSetting.isEnabled(enabled, c.packageName, DeputyAccessibilityService::class.java.name)
    return LinkRows.health(on, KeyVault.has(c, OwnerStore.settings(c)), OwnerStore.aiSource(c), OwnerStore.lastSeen(c))
  }

  private fun waiting(c: Context): List<Array<Any?>> =
    LinkRows.waiting(AgentRuntime.liveGate(), Schedules.list(c), OwnerStore.tasks(c), OwnerStore.drafts(c), Instant.now(), ZoneId.systemDefault())
      .map { arrayOf(it.id, it.label, it.dueAt, it.state) }

  // Its own read-only store: starting the runtime would close interrupted runs and prune, and a query must not write.
  private fun runs(c: Context): List<Array<Any?>> =
    LinkRows.runs(RunStore(File(c.filesDir, "deputy"), System::currentTimeMillis).list(LinkRows.RUNS_MAX_ROWS))
      .map { arrayOf(it.id, it.task, it.state, it.finishedAt) }

  private fun cursor(columns: Array<String>, rows: List<Array<Any?>>) = MatrixCursor(columns).apply { rows.forEach(::addRow) }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun getType(uri: Uri): String? = null
}
