package expo.modules.haloengine.android

import android.content.Context
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.SettingsCodec

/** The settings document lives as normalised JSON in SharedPreferences "halo" key "settings". */
object SettingsStore {
  private const val FILE = "halo"
  private const val KEY = "settings"

  fun read(ctx: Context): String = SettingsCodec.encode(load(ctx))

  fun load(ctx: Context): Settings =
    SettingsCodec.decode(ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null) ?: "{}")

  /** Decode, encode, store, then tell a running service. */
  fun write(ctx: Context, json: String) {
    val s = SettingsCodec.decode(json)
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, SettingsCodec.encode(s)).apply()
    HaloService.applySettings(s)
  }
}
