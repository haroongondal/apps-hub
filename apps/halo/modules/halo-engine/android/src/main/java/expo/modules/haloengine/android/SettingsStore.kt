package expo.modules.haloengine.android

import android.content.Context
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.SettingsCodec

/** The settings document lives as normalised JSON in SharedPreferences "halo" key "settings". */
object SettingsStore {
  private const val FILE = "halo"
  private const val KEY = "settings"
  private const val AOD_SPIKE = "aodSpike"

  fun read(ctx: Context): String = SettingsCodec.encode(load(ctx))

  fun load(ctx: Context): Settings =
    SettingsCodec.decode(ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null) ?: "{}")

  /** Decode, encode, store, then tell a running service. */
  fun write(ctx: Context, json: String) {
    val s = SettingsCodec.decode(json)
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, SettingsCodec.encode(s)).apply()
    HaloService.applySettings(s)
    // Switching the lights on from the app starts the service; switching off is handled by the service itself.
    if (s.enabled && !HaloService.running) HaloService.start(ctx, HaloService.MEDIA_PLAYBACK, "settings")
  }

  /** Diagnostics switch "Test the always-on screen"; off by default and kept out of the settings document. */
  fun aodSpike(ctx: Context): Boolean = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(AOD_SPIKE, false)

  /** A running service re-checks the switch (registers or drops its screen-off receiver, stops if nothing needs it). */
  fun setAodSpike(ctx: Context, on: Boolean) {
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(AOD_SPIKE, on).apply()
    if (HaloService.running) HaloService.applySettings(HaloService.settings)
    else if (on) HaloService.start(ctx, HaloService.MEDIA_PLAYBACK, "aodSpike")
  }

  /** Boot and listener starts only bring the service up when something needs it, so its notification never flashes. */
  fun serviceWanted(ctx: Context): Boolean = load(ctx).enabled || aodSpike(ctx)
}
