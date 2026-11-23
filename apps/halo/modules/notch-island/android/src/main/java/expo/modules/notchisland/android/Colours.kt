package expo.modules.notchisland.android

import android.graphics.Color
import expo.modules.notchisland.core.NotchSettings

object Colours {
  fun accent(accent: String): Int = Color.parseColor(NotchSettings.SWATCHES[accent] ?: NotchSettings.SWATCHES.getValue("indigo"))

  fun pill(pill: String, accent: String): Int = when (pill) {
    "graphite" -> Color.parseColor("#1C1C1E")
    "tinted" -> blend(Color.BLACK, accent(accent), 0.2f)
    else -> Color.BLACK
  }

  private fun blend(from: Int, to: Int, t: Float): Int = Color.rgb(
    (Color.red(from) + (Color.red(to) - Color.red(from)) * t).toInt(),
    (Color.green(from) + (Color.green(to) - Color.green(from)) * t).toInt(),
    (Color.blue(from) + (Color.blue(to) - Color.blue(from)) * t).toInt(),
  )
}
