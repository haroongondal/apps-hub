package expo.modules.deputyagent.android

import android.content.Context
import expo.modules.deputyagent.core.SavedTask
import expo.modules.deputyagent.core.Settings
import expo.modules.deputyagent.core.TrustLevel
import expo.modules.deputyagent.core.TrustTable
import java.util.UUID

/** SPEC §12: the owner's settings, trust choices and saved tasks. Every write returns copy for the screen, or null once saved. */
object OwnerStore {
  private fun prefs(c: Context) = c.getSharedPreferences("deputy-settings", Context.MODE_PRIVATE)
  private fun trustPrefs(c: Context) = c.getSharedPreferences("deputy-trust", Context.MODE_PRIVATE)

  // Read per node while observing, so kept in memory; setTrust replaces it, and a run sees the change at its next step.
  @Volatile private var trustCache: TrustTable? = null

  fun settings(c: Context): Settings = prefs(c).getString("settings", null)?.let(Settings::fromJson) ?: Settings()

  fun saveSettings(c: Context, input: Map<String, Any?>): String? {
    val next = try { Settings.fromMap(input) } catch (e: IllegalArgumentException) { return e.message }
    prefs(c).edit().putString("settings", next.toJson(System.currentTimeMillis())).apply()
    return null
  }

  fun trust(c: Context): TrustTable = trustCache ?: TrustTable(
    c.packageName,
    trustPrefs(c).all.mapNotNull { (pkg, v) -> TrustLevel.entries.firstOrNull { it.name == v }?.let { pkg to it } }.toMap(),
  ).also { trustCache = it }

  fun apps(c: Context): List<Map<String, Any>> {
    val t = trust(c)
    return launcherApps(c).filter { it.first != c.packageName }.sortedBy { it.second.lowercase() }.map { (pkg, label) ->
      mapOf("pkg" to pkg, "label" to label, "trust" to t.level(pkg).name.lowercase(), "financial" to t.financial(pkg))
    }
  }

  @Synchronized
  fun setTrust(c: Context, pkg: String, level: String, typed: String?): String? {
    val label = launcherApps(c).firstOrNull { it.first == pkg }?.second ?: return "That app isn't installed any more."
    val lvl = TrustLevel.entries.firstOrNull { it.name.equals(level, ignoreCase = true) } ?: return "Choose blocked, read-only or standard."
    val next = try { trust(c).set(pkg, lvl, label, typed) } catch (e: IllegalArgumentException) { return e.message }
    val edit = trustPrefs(c).edit().clear()
    next.forEach { (p, l) -> edit.putString(p, l.name) }
    edit.apply()
    trustCache = TrustTable(c.packageName, next)
    return null
  }

  fun tasks(c: Context): List<SavedTask> = prefs(c).getString("tasks", null)?.let(SavedTask::fromJson).orEmpty()

  fun saveTask(c: Context, input: Map<String, Any?>): Map<String, String?> {
    val t = try {
      SavedTask(
        (input["id"] as? String) ?: UUID.randomUUID().toString().take(8),
        (input["name"] as? String).orEmpty().trim(),
        (input["task"] as? String).orEmpty().trim(),
        (input["apps"] as? List<*>).orEmpty().filterIsInstance<String>().distinct(),
      )
    } catch (e: IllegalArgumentException) {
      return mapOf("id" to null, "error" to e.message)
    }
    val list = tasks(c)
    writeTasks(c, if (list.any { it.id == t.id }) list.map { if (it.id == t.id) t else it } else list + t)
    return mapOf("id" to t.id, "error" to null)
  }

  fun deleteTask(c: Context, id: String) = writeTasks(c, tasks(c).filter { it.id != id })

  fun toMap(t: SavedTask): Map<String, Any> = mapOf("id" to t.id, "name" to t.name, "task" to t.task, "apps" to t.apps)

  private fun writeTasks(c: Context, tasks: List<SavedTask>) = prefs(c).edit().putString("tasks", SavedTask.toJson(tasks)).apply()
}
