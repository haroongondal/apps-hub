package expo.modules.notchisland.android

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.core.TimerMode
import expo.modules.notchisland.core.TimerState
import expo.modules.notchisland.core.durationText

// Big time, then "Timer | Stopwatch", the preset chip (timer only), Start/Pause and Reset. No sound, haptics or notification.
class TimerRow(context: Context, private val density: Float) : LinearLayout(context) {
  private var accent = Color.WHITE

  private val time = TextView(context).apply {
    textSize = 30f
    setTextColor(Color.WHITE)
    setTypeface(typeface, Typeface.BOLD)
    fontFeatureSettings = "tnum"
    gravity = Gravity.CENTER_VERTICAL or Gravity.START
  }
  private val timerTab = chip("Timer") { if (NotchTimer.state.mode != TimerMode.COUNTDOWN) act(TimerAction.MODE) }
  private val stopwatchTab = chip("Stopwatch") { if (NotchTimer.state.mode != TimerMode.STOPWATCH) act(TimerAction.MODE) }
  private val preset = chip("") { act(TimerAction.PRESET) }
  private val startPause = chip("Start") { act(TimerAction.START_PAUSE) }
  private val reset = chip("Reset") { act(TimerAction.RESET) }

  init {
    orientation = VERTICAL
    val pad = (16 * density).toInt()
    setPadding(pad, (8 * density).toInt(), pad, (8 * density).toInt())

    val top = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    top.addView(time, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    top.addView(preset)
    addView(top, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

    val bottom = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    bottom.addView(timerTab)
    bottom.addView(stopwatchTab)
    bottom.addView(View(context), LayoutParams(0, 1, 1f))
    bottom.addView(startPause)
    bottom.addView(reset)
    addView(bottom, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = (6 * density).toInt() })
  }

  fun bind(state: TimerState, now: Long, accent: Int) {
    this.accent = accent
    val done = state.done(now)
    val s = if (done && state.running) state.pause(now).also { NotchTimer.state = it } else state

    if (done) {
      time.text = "Done"
      time.setTextColor(accent)
    } else {
      time.text = durationText(if (s.mode == TimerMode.COUNTDOWN) s.remaining(now) else s.elapsed(now))
      time.setTextColor(Color.WHITE)
    }

    val countdown = s.mode == TimerMode.COUNTDOWN
    style(timerTab, countdown)
    style(stopwatchTab, !countdown)
    preset.text = "${s.durationMs / 60_000} min"
    preset.visibility = if (countdown) VISIBLE else GONE
    style(preset, false)
    startPause.text = if (s.running) "Pause" else "Start"
    style(startPause, true)
    style(reset, false)
  }

  private fun act(action: TimerAction) {
    NotchTimer.onAction(action)
    bind(NotchTimer.state, SystemClock.elapsedRealtime(), accent)
  }

  private fun chip(label: String, onTap: () -> Unit) = TextView(context).apply {
    text = label
    textSize = 13f
    gravity = Gravity.CENTER
    minHeight = (36 * density).toInt()
    val h = (12 * density).toInt()
    setPadding(h, 0, h, 0)
    layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { leftMargin = (6 * density).toInt() }
    setOnClickListener { onTap() }
  }

  private fun style(chip: TextView, selected: Boolean) {
    chip.background = GradientDrawable().apply {
      cornerRadius = 18 * density
      setColor(if (selected) accent else 0x26FFFFFF)
    }
    chip.setTextColor(if (selected) Color.BLACK else Color.WHITE)
  }
}
