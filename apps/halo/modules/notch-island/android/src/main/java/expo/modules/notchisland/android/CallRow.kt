package expo.modules.notchisland.android

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.R
import expo.modules.notchisland.core.CALL_GREEN
import expo.modules.notchisland.core.HANGUP_ACTION
import expo.modules.notchisland.core.PillGeometry
import expo.modules.notchisland.core.SPEAKER_ACTION
import expo.modules.notchisland.core.callElapsed
import expo.modules.notchisland.core.durationText
import expo.modules.notchisland.core.endAvailable
import expo.modules.notchisland.core.speakerAvailable

// Green call time, then round "Speaker" and "End call" buttons. Each fires the call notification's own action and hides when the phone lacks it.
class CallRow(context: Context, private val density: Float) : LinearLayout(context) {
  private var actions: List<PendingIntent> = emptyList()

  private val time = TextView(context).apply {
    textSize = 20f
    setTextColor(CALL_GREEN)
    setTypeface(typeface, Typeface.BOLD)
    fontFeatureSettings = "tnum"
    gravity = Gravity.CENTER_VERTICAL or Gravity.START
  }
  private val speaker = roundButton(context, R.drawable.notch_speaker, "Speaker") { fire(SPEAKER_ACTION) }
  private val end = roundButton(context, R.drawable.notch_end_call, "End call") { fire(HANGUP_ACTION) }

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    val side = (PillGeometry.INSET_SIDE_DP * density).toInt()
    setPadding(side, 0, side, 0)
    val button = (44 * density).toInt()
    addView(time, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    addView(speaker, LayoutParams(button, button))
    addView(end, LayoutParams(button, button).apply { leftMargin = (12 * density).toInt() })
  }

  fun bind(info: CallInfo, now: Long, accent: Int) {
    actions = info.actions
    time.text = durationText(callElapsed(Notification.CATEGORY_CALL, info.startedAt, now) ?: 0L)
    speaker.visibility = if (speakerAvailable(info.actions.size)) VISIBLE else GONE
    end.visibility = if (endAvailable(info.actions.size)) VISIBLE else GONE
    speaker.paint(accent, Color.BLACK)
    end.paint(END_RED, Color.WHITE)
  }

  private fun fire(index: Int) {
    try {
      actions.getOrNull(index)?.send()
    } catch (_: PendingIntent.CanceledException) {
      // The call ended between bind and tap; the row goes on the next refresh.
    }
  }

  private companion object {
    val END_RED = Color.parseColor("#FF3B30")
  }
}
