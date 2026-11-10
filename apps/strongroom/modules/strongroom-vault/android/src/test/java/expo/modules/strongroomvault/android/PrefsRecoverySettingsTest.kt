package expo.modules.strongroomvault.android

import android.content.SharedPreferences
import expo.modules.strongroomvault.core.RecoveryLocal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PrefsRecoverySettingsTest {
  private val full = RecoveryLocal(
    escrowBlob = "YmxvYg==",
    confirmed = true,
    lostClaim = "Y2xhaW0=",
    lostBlob = "bG9zdA==",
    keyUnseen = true,
    lostRequestedAt = 1_800_000_000_123L,
  )

  @Test fun everyFieldSurvivesASaveAndLoad() {
    val p = MemoryPrefs()
    PrefsRecoverySettings(p).save(full)
    assertEquals(full, PrefsRecoverySettings(p).load())
  }

  @Test fun anEmptyStateLoadsAsTheDefaults() {
    assertEquals(RecoveryLocal(), PrefsRecoverySettings(MemoryPrefs()).load())
  }

  @Test fun clearingFieldsClearsThemInStorage() {
    val p = MemoryPrefs()
    val s = PrefsRecoverySettings(p)
    s.save(full)
    s.save(RecoveryLocal(keyUnseen = true))
    assertEquals(RecoveryLocal(keyUnseen = true), s.load())
  }

  @Test fun savesAreWrittenSynchronously() {
    val p = MemoryPrefs()
    PrefsRecoverySettings(p).save(full)
    assertTrue(p.committed)
  }
}

private class MemoryPrefs : SharedPreferences {
  val data = mutableMapOf<String, Any?>()
  var committed = false

  override fun getAll(): MutableMap<String, *> = data
  override fun getString(key: String, defValue: String?) = data[key] as String? ?: defValue
  override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
  override fun getInt(key: String, defValue: Int) = data[key] as Int? ?: defValue
  override fun getLong(key: String, defValue: Long) = data[key] as Long? ?: defValue
  override fun getFloat(key: String, defValue: Float) = data[key] as Float? ?: defValue
  override fun getBoolean(key: String, defValue: Boolean) = data[key] as Boolean? ?: defValue
  override fun contains(key: String) = data.containsKey(key)
  override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
  override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

  override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
    private val staged = mutableMapOf<String, Any?>()
    private val removed = mutableSetOf<String>()
    private var clear = false

    private fun put(key: String, v: Any?) = also { staged[key] = v }

    override fun putString(key: String, value: String?) = put(key, value)
    override fun putStringSet(key: String, values: MutableSet<String>?) = put(key, values)
    override fun putInt(key: String, value: Int) = put(key, value)
    override fun putLong(key: String, value: Long) = put(key, value)
    override fun putFloat(key: String, value: Float) = put(key, value)
    override fun putBoolean(key: String, value: Boolean) = put(key, value)
    override fun remove(key: String) = also { removed += key }
    override fun clear() = also { clear = true }

    override fun commit(): Boolean {
      if (clear) data.clear()
      removed.forEach(data::remove)
      staged.forEach { (k, v) -> if (v == null) data.remove(k) else data[k] = v }
      committed = true
      return true
    }

    override fun apply() {
      commit()
      committed = false // only commit() counts as the synchronous write the vault relies on
    }
  }
}
