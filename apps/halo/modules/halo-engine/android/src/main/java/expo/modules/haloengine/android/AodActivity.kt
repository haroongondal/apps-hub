package expo.modules.haloengine.android

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import expo.modules.haloengine.core.AodScreen
import expo.modules.haloengine.core.Faces
import expo.modules.haloengine.core.FlashDecision
import expo.modules.haloengine.core.Themes
import java.time.LocalTime

class AodActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private var content: AodContent? = null
  private val flashHook: (FlashDecision, Int) -> Unit = { d, c -> content?.flash(d, c) }
  private val timeout = Runnable {
    ProbeLog.log(this, "aod", "AodActivity timeout, finishing")
    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    // Only a timeout keeps it off until the next unlock; a double tap or the pocket do not.
    HaloService.aodPolicy.onTimedOut()
    finish()
  }
  private val unlocked = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      ProbeLog.log(context, "aod", "AodActivity unlocked, finishing")
      finish()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ProbeLog.log(this, "aod", "AodActivity onCreate")
    setShowWhenLocked(true)
    setTurnScreenOn(true)
    registerReceiver(unlocked, IntentFilter(Intent.ACTION_USER_PRESENT), Context.RECEIVER_EXPORTED)
    HaloService.aodFlash = flashHook
    show(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    show(intent)
  }

  private fun show(i: Intent) {
    val s = HaloService.current(this)
    val now = LocalTime.now()
    val base = Themes.resolve(s.aod, s.themes, now.hour * 60 + now.minute)
    val theme = Themes.usable(base, Faces.all.map { it().id }.toSet(), Backgrounds.exists(this, base.id))
    window.attributes = window.attributes.apply { screenBrightness = theme.brightness.toFloat() }
    val c = AodContent(this, theme, s, preview = false) { finish() }
    content = c
    setContentView(c)
    AodContent.fullScreen(window)
    HaloService.takeWakeFlash()?.let { (d, colour) -> c.flash(d, colour) }
    main.removeCallbacks(timeout)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val wake = i.getBooleanExtra(EXTRA_WAKE, false)
    val ms = AodScreen.timeoutMs(HaloService.aodPolicy.timeoutMs(s.aod), wake)
    ProbeLog.log(this, "aod", "AodActivity show theme=${theme.id} face=${theme.face} wake=$wake timeout=${ms ?: "never"}")
    if (ms != null) main.postDelayed(timeout, ms)
  }

  override fun onResume() {
    super.onResume()
    // A launch that raced an unlock must not stay over the unlocked phone.
    if (!getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
      ProbeLog.log(this, "aod", "AodActivity resumed unlocked, finishing")
      finish()
    }
  }

  override fun onDestroy() {
    main.removeCallbacks(timeout)
    runCatching { unregisterReceiver(unlocked) }
    if (HaloService.aodFlash === flashHook) HaloService.aodFlash = null
    content = null
    super.onDestroy()
    ProbeLog.log(this, "aod", "AodActivity onDestroy")
  }

  companion object {
    const val EXTRA_WAKE = "wake"
  }
}
