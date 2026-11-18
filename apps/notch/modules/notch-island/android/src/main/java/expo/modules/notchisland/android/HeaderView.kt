package expo.modules.notchisland.android

import android.app.AlarmManager
import android.content.Context
import android.graphics.Color
import android.text.format.DateFormat
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.core.NotchSettings
import expo.modules.notchisland.core.alarmLine
import expo.modules.notchisland.core.clockText
import expo.modules.notchisland.core.dateText
import java.util.Calendar

class HeaderView(context: Context) : LinearLayout(context) {
  private val clock = TextView(context).apply { textSize = 30f; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
  private val date = TextView(context).apply { textSize = 13f; setTextColor(0xB3FFFFFF.toInt()); gravity = Gravity.CENTER }
  private val alarm = TextView(context).apply { textSize = 13f; gravity = Gravity.CENTER }

  init {
    orientation = VERTICAL
    gravity = Gravity.CENTER
    addView(clock)
    addView(date)
    addView(alarm)
  }

  fun bind(s: NotchSettings, now: Calendar = Calendar.getInstance()) {
    val is24 = when (s.clock) {
      "24" -> true
      "12" -> false
      else -> DateFormat.is24HourFormat(context)
    }
    val style = if (is24) "24" else "12"
    clock.text = clockText(now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE), style)
    date.text = dateText(now.get(Calendar.DAY_OF_WEEK), now.get(Calendar.DAY_OF_MONTH), now.get(Calendar.MONTH))
    val next = context.getSystemService(AlarmManager::class.java).nextAlarmClock?.triggerTime
    val at = next?.let { Calendar.getInstance().apply { timeInMillis = it } }
    val line = at?.let { alarmLine(it.get(Calendar.HOUR_OF_DAY), it.get(Calendar.MINUTE), style) }
    alarm.text = line.orEmpty()
    alarm.setTextColor(Colours.accent(s.accent))
    alarm.visibility = if (line == null) View.GONE else View.VISIBLE
  }
}
