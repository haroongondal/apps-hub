package expo.modules.notchisland

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.notchisland.android.NotchService

class NotchIslandModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("NotchIsland")

    Function("canDrawOverlay") { Settings.canDrawOverlays(context) }

    Function("isRunning") { NotchService.running }

    Function("setEnabled") { on: Boolean ->
      val start = on && Settings.canDrawOverlays(context)
      if (start) NotchService.start(context) else NotchService.stop(context)
      start
    }

    Function("openOverlaySettings") {
      context.startActivity(
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }
}
