package expo.modules.notchisland.android

import android.app.PendingIntent
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.core.HANGUP_ACTION
import expo.modules.notchisland.core.SPEAKER_ACTION
import expo.modules.notchisland.core.durationText
import expo.modules.notchisland.core.endAvailable
import expo.modules.notchisland.core.speakerAvailable

// Green call time, then "Speaker" and "End call". Each button fires the call notification's own action and hides when the phone lacks it.
class CallRow(context: Context, private val density: Float) : LinearLayout(context) {
  private var actions: List<PendingIntent> = emptyList()

  private val time = TextView(context).apply {
    textSize = 30f
    setTextColor(CALL_GREEN)
    setTypeface(typeface, Typeface.BOLD)
    fontFeatureSettings = "tnum"
    gravity = Gravity.CENTER_VERTICAL or Gravity.START
  }
  private val speaker = chip("Speaker") { fire(SPEAKER_ACTION) }
  private val end = chip("End call") { fire(HANGUP_ACTION) }

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    val pad = (16 * density).toInt()
    setPadding(pad, (8 * density).toInt(), pad, (8 * density).toInt())
    addView(time, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    addView(speaker)
    addView(end)
  }

  fun bind(info: CallInfo, now: Long, accent: Int) {
    actions = info.actions
    time.text = durationText(now - info.startedAt)
    speaker.visibility = if (speakerAvailable(info.actions.size)) VISIBLE else GONE
    end.visibility = if (endAvailable(info.actions.size)) VISIBLE else GONE
    style(speaker, accent, Color.BLACK)
    style(end, END_RED, Color.WHITE)
  }

  private fun fire(index: Int) {
    try {
      actions.getOrNull(index)?.send()
    } catch (_: PendingIntent.CanceledException) {
      // The call ended between bind and tap; the row goes on the next refresh.
    }
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

  private fun style(chip: TextView, fill: Int, text: Int) {
    chip.background = GradientDrawable().apply {
      cornerRadius = 18 * density
      setColor(fill)
    }
    chip.setTextColor(text)
  }

  private companion object {
    val CALL_GREEN = Color.parseColor("#34C759")
    val END_RED = Color.parseColor("#FF3B30")
  }
}
