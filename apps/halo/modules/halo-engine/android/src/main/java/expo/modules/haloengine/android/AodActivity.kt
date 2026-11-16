package expo.modules.haloengine.android

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextClock

/** Spike: black screen with the time, over a locked keyguard only. Never dismisses the keyguard and never holds the screen on; finishes after 10 s or on tap. */
class AodActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private val timeout = Runnable {
    ProbeLog.log(this, "aod", "AodActivity timeout, finishing")
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
    main.postDelayed(timeout, SHOW_MS)
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

  private companion object {
    const val SHOW_MS = 10_000L
  }
}
