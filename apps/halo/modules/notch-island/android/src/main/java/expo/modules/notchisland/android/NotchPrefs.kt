package expo.modules.notchisland.android

import android.content.Context
import expo.modules.notchisland.core.NotchSettings

object NotchPrefs {
  private const val FILE = "notch_settings"
  private const val KEY = "json"

  fun load(context: Context): NotchSettings =
    NotchSettings.parse(context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null))

  fun save(context: Context, settings: NotchSettings) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, settings.toJson()).apply()
  }
}
