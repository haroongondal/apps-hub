package expo.modules.notchisland.android

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.R
import expo.modules.notchisland.core.PillGeometry
import expo.modules.notchisland.core.Transient
import expo.modules.notchisland.core.Transients

class TransientRow(context: Context, density: Float) : LinearLayout(context) {
  private val icon = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
  private val title = TextView(context).apply {
    textSize = 17f
    setTextColor(Color.WHITE)
    setTypeface(typeface, Typeface.BOLD)
    maxLines = 1
  }
  private val subtitle = TextView(context).apply {
    textSize = 13f
    setTextColor(0xA6FFFFFF.toInt())
    maxLines = 1
  }

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
    addView(text, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
  }

  fun bind(t: Transient, accent: Int) {
    val s = Transients.text(t)
    icon.setImageResource(
      when (s.icon) {
        "battery_low" -> R.drawable.notch_battery_low
        "bell" -> R.drawable.notch_bell
        "bell_off" -> R.drawable.notch_bell_off
        "moon" -> R.drawable.notch_moon
        else -> R.drawable.notch_bolt
      },
    )
    icon.imageTintList = ColorStateList.valueOf(accent)
    title.text = s.title
    subtitle.text = s.subtitle
    subtitle.visibility = if (s.subtitle == null) GONE else VISIBLE
    contentDescription = listOfNotNull(s.title, s.subtitle).joinToString(", ")
  }
}
