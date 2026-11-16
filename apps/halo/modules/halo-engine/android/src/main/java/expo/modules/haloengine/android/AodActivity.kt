package expo.modules.haloengine.android

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextClock

/** Spike: black screen with the time, over the keyguard. Never dismisses the keyguard. Tap finishes it. */
class AodActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ProbeLog.log(this, "aod", "AodActivity onCreate")
    setShowWhenLocked(true)
    setTurnScreenOn(true)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    window.attributes = window.attributes.apply { screenBrightness = 0.05f }
    val time = TextClock(this).apply {
      format12Hour = "h:mm"
      format24Hour = "HH:mm"
      textSize = 96f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    }
    setContentView(
      FrameLayout(this).apply {
        setBackgroundColor(Color.BLACK)
        addView(time, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setOnClickListener { finish() }
      },
    )
  }

  override fun onResume() {
    super.onResume()
    ProbeLog.log(this, "aod", "AodActivity onResume")
  }

  override fun onDestroy() {
    super.onDestroy()
    ProbeLog.log(this, "aod", "AodActivity onDestroy")
  }
}
