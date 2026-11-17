package expo.modules.haloengine.android

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import expo.modules.haloengine.core.RuleState
import expo.modules.haloengine.core.SettingsRules

class RuleInputs(private val ctx: Context, private val onChange: () -> Unit) {
  val state = RuleState(null, fullscreen = false, landscape = false, inCall = false, batterySaver = false, pocket = false)

  private val main = Handler(Looper.getMainLooper())
  private val wm = ctx.getSystemService(WindowManager::class.java)
  private val audio = ctx.getSystemService(AudioManager::class.java)
  private val power = ctx.getSystemService(PowerManager::class.java)
  private val usage = ctx.getSystemService(UsageStatsManager::class.java)
  private val sensors = ctx.getSystemService(SensorManager::class.java)
  private var started = false

  private val config = object : ComponentCallbacks {
    override fun onConfigurationChanged(c: Configuration) = set { state.landscape = c.orientation == Configuration.ORIENTATION_LANDSCAPE }
    @Deprecated("Required by the interface") override fun onLowMemory() = Unit
  }
  private val mode = AudioManager.OnModeChangedListener { m -> set { state.inCall = inCall(m) } }
  private val saver = object : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) = set { state.batterySaver = power.isPowerSaveMode }
  }

  private var probe: View? = null

  private var polling = false
  private var queriedTo = 0L
  private val event = UsageEvents.Event()
  private val poll = object : Runnable {
    override fun run() {
      if (!usageAllowed(ctx)) return stopPolling()
      val now = System.currentTimeMillis()
      val events = runCatching { usage.queryEvents(queriedTo, now) }.getOrNull()
      queriedTo = now
      var pkg: String? = null
      while (events != null && events.getNextEvent(event)) if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) pkg = event.packageName
      if (pkg != null && pkg != state.foregroundPkg) set { state.foregroundPkg = pkg }
      main.postDelayed(this, POLL_MS)
    }
  }

  private var proximity = false
  private val near = object : SensorEventListener {
    override fun onSensorChanged(e: SensorEvent) = set { state.pocket = e.values[0] < e.sensor.maximumRange }
    override fun onAccuracyChanged(s: Sensor, accuracy: Int) = Unit
  }

  fun start() {
    started = true
    state.landscape = ctx.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    state.inCall = inCall(audio.mode)
    state.batterySaver = power.isPowerSaveMode
    ctx.registerComponentCallbacks(config)
    audio.addOnModeChangedListener(ctx.mainExecutor, mode)
    ctx.registerReceiver(saver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), Context.RECEIVER_NOT_EXPORTED)
  }

  fun sync(r: SettingsRules) {
    if (!started) return
    if (probe == null) addProbe()
    if (r.apps.isNotEmpty() && usageAllowed(ctx)) startPolling() else stopPolling()
    if (r.pocket) startProximity() else stopProximity()
  }

  fun stop() {
    if (!started) return
    started = false
    stopPolling()
    stopProximity()
    runCatching { ctx.unregisterComponentCallbacks(config) }
    runCatching { audio.removeOnModeChangedListener(mode) }
    runCatching { ctx.unregisterReceiver(saver) }
    probe?.let { v -> runCatching { wm.removeView(v) } }
    probe = null
  }

  private fun set(change: () -> Unit) {
    change()
    if (started) onChange()
  }

  private fun addProbe() {
    if (!Settings.canDrawOverlays(ctx)) return
    val v = View(ctx)
    v.setOnApplyWindowInsetsListener { _, insets ->
      val full = !insets.isVisible(WindowInsets.Type.statusBars())
      if (full != state.fullscreen) set { state.fullscreen = full }
      insets
    }
    val lp = WindowManager.LayoutParams(
      1,
      1,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      // Fully transparent, so it adds nothing to the touch-obscuring opacity of Halo's windows.
      alpha = 0f
    }
    try {
      wm.addView(v, lp)
      probe = v
    } catch (e: Exception) {
      ProbeLog.log(ctx, "rules", "fullscreen probe add FAILED ${e.javaClass.name}: ${e.message}")
    }
  }

  private fun startPolling() {
    if (polling) return
    polling = true
    // shortcut: an app opened more than LOOKBACK_MS before polling starts is not seen until the next app switch; fine because the list is edited from inside Halo.
    queriedTo = System.currentTimeMillis() - LOOKBACK_MS
    main.post(poll)
  }

  private fun stopPolling() {
    main.removeCallbacks(poll)
    polling = false
    if (state.foregroundPkg != null) set { state.foregroundPkg = null }
  }

  private fun startProximity() {
    if (proximity) return
    val sensor = sensors.getDefaultSensor(Sensor.TYPE_PROXIMITY) ?: return
    proximity = sensors.registerListener(near, sensor, SensorManager.SENSOR_DELAY_NORMAL)
  }

  private fun stopProximity() {
    if (proximity) sensors.unregisterListener(near)
    proximity = false
    if (state.pocket) set { state.pocket = false }
  }

  companion object {
    private const val POLL_MS = 1_000L
    private const val LOOKBACK_MS = 60 * 60_000L

    fun inCall(mode: Int) = mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION || mode == AudioManager.MODE_RINGTONE

    fun usageAllowed(ctx: Context) =
      ctx.getSystemService(AppOpsManager::class.java)
        .unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName) == AppOpsManager.MODE_ALLOWED
  }
}
