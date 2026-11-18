package expo.modules.notchisland

import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.notchisland.android.NotchAccessibilityService
import expo.modules.notchisland.android.NotchPrefs
import expo.modules.notchisland.core.NotchSettings

class NotchIslandModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("NotchIsland")

    Function("isRunning") { NotchAccessibilityService.running }

    Function("openAccessibilitySettings") {
      context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("getSettings") { NotchPrefs.load(context).toJson() }

    Function("setSettings") { json: String ->
      NotchPrefs.save(context, NotchSettings.parse(json))
      NotchAccessibilityService.instance?.reapply()
      Unit
    }
  }
}
