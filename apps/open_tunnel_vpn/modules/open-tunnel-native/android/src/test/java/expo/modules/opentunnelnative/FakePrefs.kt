package expo.modules.opentunnelnative

import android.content.SharedPreferences

/** In-memory SharedPreferences for JVM tests; [commitOk] = false makes every commit report failure and save nothing. */
class FakePrefs(var commitOk: Boolean = true) : SharedPreferences {
  val data = HashMap<String, Any?>()

  override fun getAll(): MutableMap<String, *> = data
  override fun getString(key: String?, defValue: String?) = data[key] as String? ?: defValue
  override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? = throw UnsupportedOperationException()
  override fun getInt(key: String?, defValue: Int) = data[key] as Int? ?: defValue
  override fun getLong(key: String?, defValue: Long) = data[key] as Long? ?: defValue
  override fun getFloat(key: String?, defValue: Float) = data[key] as Float? ?: defValue
  override fun getBoolean(key: String?, defValue: Boolean) = data[key] as Boolean? ?: defValue
  override fun contains(key: String?) = data.containsKey(key)
  override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
  override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

  override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
    private val pending = HashMap<String, Any?>()
    override fun putString(key: String, value: String?) = apply { pending[key] = value }
    override fun putStringSet(key: String, values: MutableSet<String>?) = apply { pending[key] = values }
    override fun putInt(key: String, value: Int) = apply { pending[key] = value }
    override fun putLong(key: String, value: Long) = apply { pending[key] = value }
    override fun putFloat(key: String, value: Float) = apply { pending[key] = value }
    override fun putBoolean(key: String, value: Boolean) = apply { pending[key] = value }
    override fun remove(key: String) = apply { pending.remove(key) }
    override fun clear() = apply { pending.clear() }
    override fun commit(): Boolean {
      if (commitOk) data.putAll(pending)
      return commitOk
    }
    override fun apply() {
      commit()
    }
  }
}
