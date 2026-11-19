package expo.modules.notchisland.android

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.core.PillGeometry
import expo.modules.notchisland.core.Progress
import expo.modules.notchisland.core.ProgressSnapshot

// The app's icon, the notification title, then the app name and percent over a thin bar.
class ProgressRow(context: Context, density: Float) : LinearLayout(context) {
  private val icon = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
  private val title = line(17f, Color.WHITE).apply { setTypeface(typeface, Typeface.BOLD) }
  private val subtitle = line(13f, 0xA6FFFFFF.toInt())
  private val bar = Bar(context, density)
  private var pkg: String? = null
  private var label = ""
  private var appIcon: Drawable? = null

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    val side = (PillGeometry.INSET_SIDE_DP * density).toInt()
    setPadding(side, 0, side, 0)
    val size = (28 * density).toInt()
    addView(icon, LayoutParams(size, size).apply { rightMargin = (12 * density).toInt() })
    val text = LinearLayout(context).apply { orientation = VERTICAL }
    text.addView(title)
    text.addView(subtitle)
    text.addView(bar, LayoutParams(LayoutParams.MATCH_PARENT, (4 * density).toInt()).apply { topMargin = (6 * density).toInt() })
    addView(text, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
  }

  fun bind(p: ProgressSnapshot, accent: Int) {
    if (p.pkg != pkg) {
      pkg = p.pkg
      val pm = context.packageManager
      label = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(p.pkg, PackageManager.ApplicationInfoFlags.of(0))).toString() }.getOrDefault("")
      appIcon = runCatching { pm.getApplicationIcon(p.pkg) }.getOrNull()
    }
    icon.setImageDrawable(appIcon)
    val t = Progress.text(p, label)
    title.text = t.title
    subtitle.text = t.subtitle
    subtitle.visibility = if (t.subtitle.isEmpty()) GONE else VISIBLE
    bar.bind(p.percent, accent)
    contentDescription = listOf(t.title, t.subtitle).filter { it.isNotEmpty() }.joinToString(", ")
  }

  private fun line(size: Float, colour: Int) = TextView(context).apply {
    textSize = size
    setTextColor(colour)
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }

  private class Bar(context: Context, density: Float) : View(context) {
    private var fraction = 0f
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SOFT }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val radius = 2 * density

    fun bind(percent: Int?, accent: Int) {
      visibility = if (percent == null) GONE else VISIBLE
      fraction = (percent ?: 0).coerceIn(0, 100) / 100f
      fill.color = accent
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val h = height.toFloat()
      canvas.drawRoundRect(0f, 0f, width.toFloat(), h, radius, radius, track)
      if (fraction > 0f) canvas.drawRoundRect(0f, 0f, maxOf(h, width * fraction), h, radius, radius, fill)
    }
  }
}
