package expo.modules.notchisland.android

import android.app.AlarmManager
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.text.format.DateFormat
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.core.NotchSettings
import expo.modules.notchisland.core.PillGeometry
import expo.modules.notchisland.core.Progress
import expo.modules.notchisland.core.Transient
import expo.modules.notchisland.core.alarmLine
import expo.modules.notchisland.core.batteryText
import expo.modules.notchisland.core.clockText
import expo.modules.notchisland.core.dateText
import expo.modules.notchisland.core.earLayout
import expo.modules.notchisland.core.rowsFor
import java.util.Calendar

// Time in the left ear, battery in the right, with the camera hole between them; the date and alarm line sits below, then the widget rows.
class IslandCard(context: Context, holeWidth: Int, earHeight: Int, private val density: Float) : LinearLayout(context) {
  private val time = TextView(context).apply {
    textSize = 15f
    setTextColor(Color.WHITE)
    gravity = Gravity.CENTER_VERTICAL or Gravity.START
    setPadding(dp(PillGeometry.INSET_SIDE_DP), 0, 0, 0)
    setTypeface(typeface, android.graphics.Typeface.BOLD)
  }
  private val ring = Ring(context)
  private val percent = TextView(context).apply { textSize = 13f; setTextColor(Color.WHITE) }
  private val battery = LinearLayout(context).apply {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL or Gravity.END
    setPadding(0, 0, dp(PillGeometry.INSET_SIDE_DP), 0)
    addView(ring, LayoutParams((18 * density).toInt(), (18 * density).toInt()).apply { rightMargin = (6 * density).toInt() })
    addView(percent)
  }
  private val sub = TextView(context).apply {
    textSize = 12f
    setTextColor(0xB3FFFFFF.toInt())
    gravity = Gravity.CENTER
  }
  private val callRow = CallRow(context, density)
  private val mediaRow = MediaRow(context, density)
  private val timerRow = TimerRow(context, density)
  private val transientRow = TransientRow(context, density)
  private val progressRow = ProgressRow(context, density)
  private val rows = LinearLayout(context).apply { orientation = VERTICAL; setPadding(0, dp(PillGeometry.INSET_BELOW_HOLE_DP), 0, 0) }
  private var accent = Color.WHITE
  private var dateLine = false
  var onTouchDown: (() -> Unit)? = null
  var transient: Transient? = null

  init {
    orientation = VERTICAL
    val ears = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    ears.addView(time, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
    ears.addView(View(context), LayoutParams(holeWidth, LayoutParams.MATCH_PARENT))
    ears.addView(battery, LayoutParams(0, LayoutParams.MATCH_PARENT, 1f))
    addView(ears, LayoutParams(LayoutParams.MATCH_PARENT, earHeight))
    addView(sub, LayoutParams(LayoutParams.MATCH_PARENT, dp(PillGeometry.DATE_LINE_DP)))
    addView(rows, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
  }

  // Sees every touch in the card before its controls do, without taking it.
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) onTouchDown?.invoke()
    return false
  }

  // A transient event alone; else the call row first, then the media and timer rows in widget order, each only when it has something to show, then a progress card last.
  fun activeRows(s: NotchSettings): List<View> {
    if (transient != null) return listOf(transientRow)
    val rows = listOfNotNull(callRow.takeIf { NotchMedia.call != null }) +
      rowsFor(s.widgets).mapNotNull { if (it == "media") mediaRow.takeIf { r -> r.isVisibleFor(NotchMedia.media) } else timerRow }
    return rows + listOfNotNull(progressRow.takeIf { Progress.show(s.progressCards, NotchMedia.progress, rows.map(::kind)) })
  }

  fun activeKinds(s: NotchSettings): List<String> = activeRows(s).map(::kind)

  private fun kind(row: View) = when (row) {
    callRow -> "call"
    mediaRow -> "media"
    transientRow -> "event"
    progressRow -> "progress"
    else -> "timer"
  }

  // A row takes the date line's place, as an iPhone live activity replaces the idle island.
  fun bindRows(s: NotchSettings) {
    accent = Colours.accent(s.accent)
    rows.removeAllViews()
    val active = activeRows(s)
    for ((i, row) in active.withIndex()) {
      rows.addView(row, LayoutParams(LayoutParams.MATCH_PARENT, dp(PillGeometry.rowDp(kind(row)))).apply { if (i > 0) topMargin = dp(PillGeometry.ROW_GAP_DP) })
    }
    rows.visibility = if (active.isEmpty()) GONE else VISIBLE
    sub.visibility = if (dateLine && active.isEmpty()) VISIBLE else GONE
    mediaRow.bind(NotchMedia.media, accent, NotchFeed.controller)
    transient?.let { transientRow.bind(it, accent) }
    NotchMedia.progress?.let { progressRow.bind(it, accent) }
    tickRows()
  }

  // The once-a-second part: the call time and the timer.
  fun tickRows() {
    NotchMedia.call?.let { callRow.bind(it, System.currentTimeMillis(), accent) }
    timerRow.bind(NotchTimer.state, SystemClock.elapsedRealtime(), accent)
  }

  fun bind(s: NotchSettings, now: Calendar, batteryPercent: Int?, charging: Boolean) {
    val ears = earLayout(s.widgets)
    val is24 = when (s.clock) {
      "24" -> true
      "12" -> false
      else -> DateFormat.is24HourFormat(context)
    }
    val style = if (is24) "24" else "12"
    val accent = Colours.accent(s.accent)

    time.visibility = if (ears.time) VISIBLE else INVISIBLE
    time.text = clockText(now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE), style)
    battery.visibility = if (ears.battery) VISIBLE else INVISIBLE
    if (batteryPercent != null) {
      ring.bind(batteryPercent, accent)
      percent.text = batteryText(batteryPercent, charging)
    }

    val next = context.getSystemService(AlarmManager::class.java).nextAlarmClock?.triggerTime
    val at = next?.let { Calendar.getInstance().apply { timeInMillis = it } }
    val alarm = at?.let { alarmLine(it.get(Calendar.HOUR_OF_DAY), it.get(Calendar.MINUTE), style) }
    val date = dateText(now.get(Calendar.DAY_OF_WEEK), now.get(Calendar.DAY_OF_MONTH), now.get(Calendar.MONTH))
    sub.text = listOfNotNull(date, alarm).joinToString("  ·  ")
    dateLine = ears.dateLine
    bindRows(s)
  }

  private fun dp(v: Int) = (v * density).toInt()

  private class Ring(context: Context) : View(context) {
    private val density = context.resources.displayMetrics.density
    private var fraction = 0f
    private var accent = Color.WHITE
    private val rect = RectF()
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * density; color = 0x33FFFFFF }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * density; strokeCap = Paint.Cap.ROUND }

    fun bind(percent: Int, accentArgb: Int) {
      fraction = percent.coerceIn(0, 100) / 100f
      accent = accentArgb
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val pad = 1.5f * density
      rect.set(pad, pad, width - pad, height - pad)
      canvas.drawArc(rect, 0f, 360f, false, track)
      arc.color = accent
      canvas.drawArc(rect, -90f, 360f * fraction, false, arc)
    }
  }
}

internal const val SOFT = 0x26FFFFFF

// A round, icon-only button for the rows; paint() sets its fill and icon colour on bind.
internal fun roundButton(context: Context, icon: Int, label: String, onTap: () -> Unit) = ImageButton(context).apply {
  setImageResource(icon)
  contentDescription = label
  scaleType = ImageView.ScaleType.CENTER
  background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(SOFT) }
  setOnClickListener { onTap() }
}

internal fun ImageButton.paint(fill: Int, icon: Int) {
  (background as GradientDrawable).setColor(fill)
  imageTintList = ColorStateList.valueOf(icon)
}
