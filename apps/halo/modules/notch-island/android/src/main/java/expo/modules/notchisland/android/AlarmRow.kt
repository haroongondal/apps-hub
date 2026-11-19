package expo.modules.notchisland.android

import android.app.PendingIntent
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.text.TextUtils
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.R
import expo.modules.notchisland.core.PillGeometry
import expo.modules.notchisland.core.clockText
import java.util.Calendar

// Alarm icon, the alarm's title over its time, then round "Snooze" and "Dismiss" buttons that fire the alarm notification's own actions.
class AlarmRow(context: Context, density: Float) : LinearLayout(context) {
  private var info: AlarmInfo? = null
  private val icon = ImageView(context).apply { setImageResource(R.drawable.notch_alarm); scaleType = ImageView.ScaleType.FIT_CENTER }
  private val title = line(17f, Color.WHITE).apply { setTypeface(typeface, Typeface.BOLD) }
  private val time = line(13f, 0xA6FFFFFF.toInt()).apply { fontFeatureSettings = "tnum" }
  private val snooze = roundButton(context, R.drawable.notch_snooze, "Snooze") { fire(info?.snooze) }
  private val dismiss = roundButton(context, R.drawable.notch_reset, "Dismiss") { fire(info?.dismiss) }

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    val side = (PillGeometry.INSET_SIDE_DP * density).toInt()
    setPadding(side, 0, side, 0)
    val size = (28 * density).toInt()
    addView(icon, LayoutParams(size, size).apply { rightMargin = (12 * density).toInt() })
    val text = LinearLayout(context).apply { orientation = VERTICAL }
    text.addView(title)
    text.addView(time)
    addView(text, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    val button = (44 * density).toInt()
    addView(snooze, LayoutParams(button, button).apply { leftMargin = (12 * density).toInt() })
    addView(dismiss, LayoutParams(button, button).apply { leftMargin = (12 * density).toInt() })
  }

  fun bind(alarm: AlarmInfo, clock: String, accent: Int) {
    info = alarm
    val at = Calendar.getInstance().apply { timeInMillis = alarm.snap.at }
    title.text = alarm.snap.title
    time.text = clockText(at.get(Calendar.HOUR_OF_DAY), at.get(Calendar.MINUTE), clock)
    icon.imageTintList = ColorStateList.valueOf(accent)
    snooze.visibility = if (alarm.snooze != null) VISIBLE else GONE
    dismiss.visibility = if (alarm.dismiss != null) VISIBLE else GONE
    snooze.paint(SOFT, Color.WHITE)
    dismiss.paint(accent, Color.BLACK)
    contentDescription = "${title.text}, ${time.text}"
  }

  private fun fire(intent: PendingIntent?) {
    try {
      intent?.send()
    } catch (_: PendingIntent.CanceledException) {
      // The alarm stopped between bind and tap; the row goes on the next refresh.
    }
  }

  private fun line(size: Float, colour: Int) = TextView(context).apply {
    textSize = size
    setTextColor(colour)
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }
}
