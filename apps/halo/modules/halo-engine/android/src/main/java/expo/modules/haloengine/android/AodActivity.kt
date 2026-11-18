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
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.Theme
import expo.modules.haloengine.core.Themes
import java.time.LocalTime

class AodActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private var content: AodContent? = null
  private val flashHook: (FlashDecision, Int) -> Unit = { d, c -> content?.flash(d, c) }
  private val closeHook: () -> Unit = { end("power button") }
  private val timeout = Runnable { end("timeout") }
  private var themeId = ""
  // Time slots switch the theme while it shows; the timeout and keep-screen-on stay as they are.
  private val tick = object : Runnable {
    override fun run() {
      val s = HaloService.current(this@AodActivity)
      AodScreen.switchTheme(s.aod, s.themes, minuteOfDay(), themeId)?.let {
        build(it, s)
        ProbeLog.log(this@AodActivity, "aod", "AodActivity time slot, theme=${it.id}")
      }
      main.postDelayed(this, untilNextMinute())
    }
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
    val theme = build(Themes.resolve(s.aod, s.themes, minuteOfDay()), s)
    HaloService.aodClose = closeHook
    HaloService.takeWakeFlash()?.let { (d, colour) -> content?.flash(d, colour) }
    main.removeCallbacks(timeout)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val wake = i.getBooleanExtra(EXTRA_WAKE, false)
    val ms = AodScreen.timeoutMs(HaloService.aodPolicy.timeoutMs(s.aod), wake)
    ProbeLog.log(this, "aod", "AodActivity show theme=${theme.id} face=${theme.face} wake=$wake timeout=${ms ?: "never"}")
    if (ms != null) main.postDelayed(timeout, ms)
    main.removeCallbacks(tick)
    main.postDelayed(tick, untilNextMinute())
  }

  /** Content, face and brightness for a theme; leaves the timeout and keep-screen-on alone. */
  private fun build(base: Theme, s: Settings): Theme {
    val theme = Themes.usable(base, Faces.all.map { it().id }.toSet(), Backgrounds.exists(this, base.id))
    themeId = base.id
    window.attributes = window.attributes.apply { screenBrightness = theme.brightness.toFloat() }
    val c = AodContent(this, theme, s, preview = false, onLeave = { finish() }, onPocket = { end("pocket") })
    content = c
    setContentView(c)
    AodContent.fullScreen(window)
    return theme
  }

  /** A timeout, the pocket or the power button keep it off until the next unlock or a notification wake; a double tap does not. */
  private fun end(why: String) {
    ProbeLog.log(this, "aod", "AodActivity ended by $why, finishing")
    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    HaloService.aodPolicy.onTimedOut()
    finish()
  }

  override fun finish() {
    release()
    super.finish()
  }

  private fun release() {
    main.removeCallbacks(timeout)
    main.removeCallbacks(tick)
    if (HaloService.aodClose === closeHook) HaloService.aodClose = null
  }

  private fun minuteOfDay() = LocalTime.now().let { it.hour * 60 + it.minute }

  private fun untilNextMinute() = 60_000L - System.currentTimeMillis() % 60_000L

  override fun onResume() {
    super.onResume()
    // A launch that raced an unlock must not stay over the unlocked phone.
    if (!getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
      ProbeLog.log(this, "aod", "AodActivity resumed unlocked, finishing")
      finish()
    }
  }

  override fun onDestroy() {
    release()
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
