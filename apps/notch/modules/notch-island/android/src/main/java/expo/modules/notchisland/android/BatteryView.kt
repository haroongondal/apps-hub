package expo.modules.notchisland.android

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.core.batteryText

class BatteryView(context: Context) : LinearLayout(context) {
  private val density = context.resources.displayMetrics.density
  private var fraction = 0f
  private var accent = Color.WHITE
  private val rect = RectF()
  private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 5 * density; color = 0x33FFFFFF }
  private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 5 * density; strokeCap = Paint.Cap.ROUND }
  private val ring = object : View(context) {
    override fun onDraw(canvas: Canvas) {
      val pad = 2.5f * density
      rect.set(pad, pad, width - pad, height - pad)
      canvas.drawArc(rect, 0f, 360f, false, track)
      arc.color = accent
      canvas.drawArc(rect, -90f, 360f * fraction, false, arc)
    }
  }
  private val label = TextView(context).apply { textSize = 13f; setTextColor(0xB3FFFFFF.toInt()); gravity = Gravity.CENTER }

  init {
    orientation = VERTICAL
    gravity = Gravity.CENTER
    addView(ring, LayoutParams((40 * density).toInt(), (40 * density).toInt()))
    addView(label)
  }

  fun bind(percent: Int, charging: Boolean, accentArgb: Int) {
    fraction = percent.coerceIn(0, 100) / 100f
    accent = accentArgb
    ring.invalidate()
    label.text = batteryText(percent, charging)
  }
}
