package expo.modules.haloengine.android

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextClock

/** Spike clock (rewritten in a later task): black screen with the time, over a locked keyguard only. Never dismisses the keyguard and never holds the screen on; finishes after the theme timeout (never, if "Never stop") or on tap. */
class AodActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private val timeout = Runnable {
    ProbeLog.log(this, "aod", "AodActivity timeout, finishing")
    // Timed out by itself: the screen stays off until the next unlock.
    HaloService.aodPolicy.onTimedOut()
    finish()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ProbeLog.log(this, "aod", "AodActivity onCreate")
    setShowWhenLocked(true)
    setTurnScreenOn(true)
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
    val ms = HaloService.aodPolicy.timeoutMs(HaloService.settings.aod)
    ProbeLog.log(this, "aod", "AodActivity timeout=${ms ?: "never"}")
    if (ms != null) main.postDelayed(timeout, ms)
  }

  override fun onResume() {
    super.onResume()
    ProbeLog.log(this, "aod", "AodActivity onResume")
  }

  override fun onDestroy() {
    main.removeCallbacks(timeout)
    super.onDestroy()
    ProbeLog.log(this, "aod", "AodActivity onDestroy")
  }
}
