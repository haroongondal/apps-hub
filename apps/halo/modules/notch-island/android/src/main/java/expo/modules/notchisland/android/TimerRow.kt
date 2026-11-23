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
import expo.modules.notchisland.R
import expo.modules.notchisland.core.PillGeometry
import expo.modules.notchisland.core.TimerMode
import expo.modules.notchisland.core.TimerState
import expo.modules.notchisland.core.durationText

// Big time with round Start/Pause and Reset beside it, then "Timer | Stopwatch" and the preset chip (timer only). No sound, haptics or notification.
class TimerRow(context: Context, private val density: Float) : LinearLayout(context) {
  private var accent = Color.WHITE

  private val time = TextView(context).apply {
    textSize = 30f
    setTextColor(Color.WHITE)
    setTypeface(typeface, Typeface.BOLD)
    fontFeatureSettings = "tnum"
    includeFontPadding = false
    gravity = Gravity.CENTER_VERTICAL or Gravity.START
  }
  private val timerTab = chip("Timer", 0) { if (NotchTimer.state.mode != TimerMode.COUNTDOWN) act(TimerAction.MODE) }
  private val stopwatchTab = chip("Stopwatch") { if (NotchTimer.state.mode != TimerMode.STOPWATCH) act(TimerAction.MODE) }
  private val preset = chip("") { act(TimerAction.PRESET) }
  private val startPause = roundButton(context, R.drawable.notch_play, "Start") { act(TimerAction.START_PAUSE) }
  private val reset = roundButton(context, R.drawable.notch_reset, "Reset") { act(TimerAction.RESET) }

  init {
    orientation = VERTICAL
    val side = dp(PillGeometry.INSET_SIDE_DP)
    setPadding(side, 0, side, 0)

    val button = dp(44)
    val top = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    top.addView(time, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    top.addView(startPause, LayoutParams(button, button))
    top.addView(reset, LayoutParams(button, button).apply { leftMargin = dp(12) })
    addView(top, LayoutParams(LayoutParams.MATCH_PARENT, button))

    val bottom = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    bottom.addView(timerTab)
    bottom.addView(stopwatchTab)
    bottom.addView(View(context), LayoutParams(0, 1, 1f))
    bottom.addView(preset)
    addView(bottom, LayoutParams(LayoutParams.MATCH_PARENT, dp(36)).apply { topMargin = dp(8) })
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
    startPause.setImageResource(if (s.running) R.drawable.notch_pause else R.drawable.notch_play)
    startPause.contentDescription = if (s.running) "Pause" else "Start"
    startPause.paint(accent, Color.BLACK)
    reset.paint(SOFT, Color.WHITE)
  }

  private fun act(action: TimerAction) {
    NotchTimer.onAction(action)
    bind(NotchTimer.state, SystemClock.elapsedRealtime(), accent)
  }

  private fun dp(v: Int) = (v * density).toInt()

  private fun chip(label: String, marginDp: Int = 6, onTap: () -> Unit) = TextView(context).apply {
    text = label
    textSize = 13f
    gravity = Gravity.CENTER
    minHeight = dp(36)
    val h = dp(12)
    setPadding(h, 0, h, 0)
    layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(marginDp) }
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
