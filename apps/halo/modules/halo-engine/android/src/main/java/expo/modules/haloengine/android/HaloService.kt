package expo.modules.haloengine.android

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.WallpaperManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.drawable.Icon
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.haloengine.core.AodPolicy
import expo.modules.haloengine.core.AodScreen
import expo.modules.haloengine.core.AodState
import expo.modules.haloengine.core.AudioState
import expo.modules.haloengine.core.AudioWatch
import expo.modules.haloengine.core.ChargeEffect
import expo.modules.haloengine.core.ChargeWake
import expo.modules.haloengine.core.ColorSource
import expo.modules.haloengine.core.DotKind
import expo.modules.haloengine.core.FlashDecision
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.Patterns
import expo.modules.haloengine.core.RandomMotion
import expo.modules.haloengine.core.Rules
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.serviceWanted
import expo.modules.haloengine.core.shouldWakeForCharge
import expo.modules.haloengine.core.Spectrum
import expo.modules.haloengine.core.SpectrumFrame
import java.time.LocalTime
import java.util.concurrent.Executors

/** Foreground service that owns the audio tap, the playing state, the colours and the edge overlay; start paths still log to probe.log. */
class HaloService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var tap: AudioTap? = null
  private var overlay: EdgeOverlay? = null
  private var media: MediaWatch? = null
  private var rules: RuleInputs? = null
  private var hidden = false
  private var screenOff: BroadcastReceiver? = null
  private var chargeRead: SensorEventListener? = null
  private var chargeLock: PowerManager.WakeLock? = null
  private val chargeTimeout = Runnable { endChargeRead(null) }

  // Art or wallpaper colours for `derivedFor`; null derived means the source gave nothing, so the palette is used.
  private val worker = Executors.newSingleThreadExecutor()
  private var derived: IntArray? = null
  private var derivedFor: ColorSource? = null
  private var colourGen = 0
  private val wallpaperListener = WallpaperManager.OnColorsChangedListener { _, which ->
    if (which and WallpaperManager.FLAG_SYSTEM != 0) recomputeColors()
  }

  private val spectrum = Spectrum(BANDS)
  private var frame = SpectrumFrame(FloatArray(BANDS), 0f, false)
  private val randomFrame = SpectrumFrame(FloatArray(BANDS), 0f, false)
  private val watch = AudioWatch()
  private var state: AudioState? = null
  private var attempt = 0
  private var patternId = ""
  private var pattern: Pattern = Patterns.create("")

  private val retry = Runnable { startTap() }
  private val source = object : EdgeView.Source {
    override fun animate(nowMs: Long) = watch.animate(nowMs)
    override fun spectrum(nowMs: Long) = frameAt(nowMs)
  }
  // Blocked audio sends no FFT to kick the frame loop, so random motion needs its own wake-up.
  private val randomCheck = Runnable { if (watch.animate(now())) overlay?.kick() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val type = intent?.getIntExtra(EXTRA_TYPE, MEDIA_PLAYBACK) ?: MEDIA_PLAYBACK
    val path = intent?.getStringExtra(EXTRA_PATH) ?: "restart"
    ProbeLog.log(this, "service", "onStartCommand path=$path type=${typeName(type)} sdk=${Build.VERSION.SDK_INT} alreadyRunning=$running")
    try {
      startForeground(NOTIFICATION_ID, notification(), type)
      ProbeLog.log(this, "service", "startForeground ok path=$path type=${typeName(type)}")
    } catch (e: Exception) {
      ProbeLog.log(this, "service", "startForeground FAILED path=$path type=${typeName(type)} ${e.javaClass.name}: ${e.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    if (running) {
      attachWindow()
      return START_NOT_STICKY
    }
    running = true
    ProbeLog.log(this, "service", "notificationsEnabled=${getSystemService(NotificationManager::class.java).areNotificationsEnabled()}")
    onSettings = { s -> main.post { apply(s) } }
    onRetryWindow = { main.post { attachWindow() } }
    onFlash = { d, c -> overlay?.takeIf { it.attached }?.let { it.flash(d, c); true } ?: false }
    // A listener reconnect leaves the old session watch empty, so it is rebuilt.
    onListener = { main.post { media?.run { stop(); start() } } }
    applySettings(SettingsStore.load(this))
    return START_NOT_STICKY
  }

  private fun now() = SystemClock.uptimeMillis()

  private fun apply(s: Settings) {
    if (!running) return
    syncScreenOff(s.aod.enabled)
    if (!s.enabled && !preview) {
      lightsOff()
      ProbeLog.log(this, "service", "lights disabled")
      // The always-on screen needs the screen-off receiver, and notification wakes need the policy, which live as long as this service.
      if (!s.serviceWanted) stopSelf()
      check()
      return
    }
    watch.onPreview(preview)
    if (s.pattern != patternId) {
      pattern = Patterns.create(s.pattern)
      patternId = s.pattern
    }
    val first = overlay == null
    if (first) lightsOn() else if (overlay?.attached == false) overlay?.add()
    overlay?.apply(s, pattern, currentColors(s))
    rules?.sync(s.rules)
    onRules()
    if (first || s.colors.source != derivedFor) recomputeColors()
    if (watch.animate(now())) overlay?.kick()
  }

  private fun currentColors(s: Settings): IntArray =
    derived?.takeIf { s.colors.source == derivedFor } ?: s.colors.palette.map { Color.parseColor(it) }.toIntArray()

  /** Re-derives the colours for the current source; bitmap work runs on `worker`, the result swaps in on main. */
  private fun recomputeColors() {
    val source = settings.colors.source
    val controller = media?.playing
    val gen = ++colourGen
    worker.execute {
      val out = when (source) {
        ColorSource.ALBUM_ART -> Colours.albumArt(this, controller)
        ColorSource.WALLPAPER -> Colours.wallpaper(this)
        ColorSource.PALETTE -> null
      }
      main.post {
        if (gen != colourGen || !running) return@post
        derived = out
        derivedFor = source
        val colours = currentColors(settings)
        overlay?.setColors(colours)
        val used = if (out != null) source.key else ColorSource.PALETTE.key
        ProbeLog.log(this, "colours", "colours source=$used n=${colours.size} ${colours.joinToString(",") { "#%06X".format(it and 0xFFFFFF) }}")
      }
    }
  }

  private fun lightsOn() {
    overlay = EdgeOverlay(this, source).also { it.add() }
    rules = RuleInputs(this, ::onRules).also { it.start() }
    // Assigned before start(): start() reports an already-playing session through onMedia, which reads `media`.
    media = MediaWatch(this, ::onMedia, ::recomputeColors)
    media?.start()
    runCatching { getSystemService(WallpaperManager::class.java).addOnColorsChangedListener(wallpaperListener, main) }
    startTap()
  }

  /** Retries only the window add while the lights are on but the window is missing (overlay access granted later). */
  private fun attachWindow() {
    val o = overlay ?: return
    rules?.sync(settings.rules)
    if (o.attached || !o.add()) return
    o.apply(settings, pattern, currentColors(settings))
    if (watch.animate(now())) o.kick()
  }

  private fun lightsOff() {
    main.removeCallbacks(retry)
    main.removeCallbacks(randomCheck)
    tap?.stop()
    tap = null
    media?.stop()
    media = null
    runCatching { getSystemService(WallpaperManager::class.java).removeOnColorsChangedListener(wallpaperListener) }
    colourGen++
    playingApp = null
    watch.onPlaying(false)
    rules?.stop()
    rules = null
    hidden = false
    overlay?.remove()
    overlay = null
    attempt = 0
  }

  // A settings screen is open in preview, so the lights show whatever the rules say.
  private fun onRules() {
    val st = rules?.state ?: return
    val h = !preview && Rules.hidden(settings.rules, st)
    if (h == hidden) return
    hidden = h
    ProbeLog.log(this, "rules", "lights ${if (h) "hidden" else "shown"} app=${st.foregroundPkg} fullscreen=${st.fullscreen} landscape=${st.landscape} call=${st.inCall} saver=${st.batterySaver} pocket=${st.pocket}")
    overlay?.setHidden(h)
    // A kick after showing either resumes the music or fades out the frame left over from before the hide.
    if (!h) overlay?.kick()
  }

  private fun startTap() {
    tap?.stop()
    tap = AudioTap(this, ::onFft, ::onInit).also { it.start() }
  }

  private fun onInit(ok: Boolean) {
    watch.onInit(ok, now())
    if (ok) {
      attempt = 0
    } else {
      val delay = watch.retryDelayMs(attempt++)
      ProbeLog.log(this, "audio", "retry in ${delay}ms attempt=$attempt")
      main.postDelayed(retry, delay)
      main.postDelayed(randomCheck, RANDOM_CHECK_MS)
    }
    check()
  }

  private fun onFft(fft: ByteArray, nonZero: Boolean) {
    val t = now()
    frame = spectrum.update(fft, t)
    watch.onFft(nonZero, t)
    check()
    if (watch.animate(t)) overlay?.kick()
  }

  // shortcut: without listener access playing stays false, so no random motion (FFT frames arrive even in silence and would keep it animating); fine until a playing signal without the listener exists.
  private fun onMedia() {
    playingApp = media?.playingApp
    watch.onPlaying(playingApp != null)
    main.removeCallbacks(randomCheck)
    if (playingApp != null) main.postDelayed(randomCheck, RANDOM_CHECK_MS)
    publish()
    recomputeColors()
  }

  private fun frameAt(t: Long): SpectrumFrame {
    if (!watch.useRandom(t)) return frame
    RandomMotion.fill(randomFrame.bands, t, RANDOM_SEED)
    randomFrame.level = randomFrame.bands.average().toFloat()
    return randomFrame
  }

  private fun check() {
    val s = if (overlay == null) null else watch.state(now())
    if (s == state) return
    state = s
    ProbeLog.log(this, "audio", "state=${s?.name ?: "off"}")
    publish()
  }

  private fun publish() {
    audio = when (state) {
      AudioState.OK -> "ok"
      AudioState.BLOCKED -> "blocked"
      else -> "idle"
    }
    onChange?.invoke()
  }

  /** The screen-off receiver exists only while the always-on screen is enabled. */
  private fun syncScreenOff(enabled: Boolean) {
    if (enabled && screenOff == null) {
      registerScreenOff()
      ProbeLog.log(this, "aod", "screen-off receiver registered")
    } else if (!enabled && screenOff != null) {
      unregisterScreenOff()
      ProbeLog.log(this, "aod", "screen-off receiver removed")
    }
  }

  private fun unregisterScreenOff() {
    stopChargeRead()
    screenOff?.let { runCatching { unregisterReceiver(it) } }
    screenOff = null
  }

  private fun registerScreenOff() {
    aodPolicy.onUnlocked()
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, i: Intent) {
        if (i.action == Intent.ACTION_USER_PRESENT) {
          aodPolicy.onUnlocked()
          ProbeLog.log(context, "aod", "phone unlocked, the always-on screen may show again")
          return
        }
        if (i.action == Intent.ACTION_POWER_CONNECTED) {
          onPlugIn()
          return
        }
        // Launching over an unlocked phone would cancel its pending lock, so AodPolicy only allows a locked one.
        val st = aodState(context)
        val showing = aodShowing
        if (!aodPolicy.onScreenOff(settings.aod, st, showing)) {
          if (showing) {
            ProbeLog.log(context, "aod", "power pressed on the always-on screen, off until unlock")
            aodClose?.invoke()
            return
          }
          ProbeLog.log(context, "aod", "aod skipped: enabled=${settings.aod.enabled} locked=${st.keyguardLocked} charging=${st.charging} music=${st.musicPlaying} trigger=${settings.aod.trigger.key} minute=${st.minuteOfDay}")
          return
        }
        ProbeLog.log(context, "aod", "SCREEN_OFF received, keyguard locked, launching AodActivity")
        launchAod(context, wake = false)
      }
    }
    val filter = IntentFilter(Intent.ACTION_SCREEN_OFF).apply {
      addAction(Intent.ACTION_USER_PRESENT)
      addAction(Intent.ACTION_POWER_CONNECTED)
    }
    // SystemUI, not the system uid, sends USER_PRESENT, so a not-exported receiver never gets it; all three actions are protected broadcasts, so no app can fake them.
    registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
    screenOff = r
  }

  /** A plug-in onto a dark screen wakes the always-on screen, but only after one proximity reading says it is not in a pocket. */
  private fun onPlugIn() {
    val s = settings
    val screenOn = getSystemService(PowerManager::class.java).isInteractive
    if (chargeRead != null || !ChargeWake.wanted(plugIn = true, screenOn, aodShowing, s.aod.enabled, s.aod.wakeOnCharge)) return
    if (!chargeWakeAllowed(s)) {
      ProbeLog.log(this, "aod", "charge wake skipped by the always-on policy (lock, trigger or off hours)")
      return
    }
    val sensors = getSystemService(SensorManager::class.java)
    val sensor = sensors?.getDefaultSensor(Sensor.TYPE_PROXIMITY)
    val l = object : SensorEventListener {
      override fun onSensorChanged(e: SensorEvent) = endChargeRead(AodScreen.near(e.values[0], e.sensor.maximumRange))
      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }
    if (sensor == null || !sensors.registerListener(l, sensor, SensorManager.SENSOR_DELAY_NORMAL, main)) {
      ProbeLog.log(this, "aod", "charge wake skipped: no proximity sensor")
      return
    }
    chargeRead = l
    // The CPU may sleep once the broadcast returns; this keeps the timeout on time and expires on its own if all else fails.
    chargeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "halo:chargewake")
      .apply { acquire(PROXIMITY_TIMEOUT_MS + 500) }
    main.postDelayed(chargeTimeout, PROXIMITY_TIMEOUT_MS)
  }

  /** near null: no reading before the timeout, which counts as a pocket. */
  private fun endChargeRead(near: Boolean?) {
    if (!stopChargeRead()) return
    val s = settings
    val screenOn = getSystemService(PowerManager::class.java).isInteractive
    if (!shouldWakeForCharge(screenOn, aodShowing, s.aod.enabled, s.aod.wakeOnCharge, near, plugIn = true) || !chargeWakeAllowed(s)) {
      ProbeLog.log(this, "aod", "charge wake skipped: near=$near screenOn=$screenOn showing=$aodShowing")
      return
    }
    if (s.aod.chargeEffect == ChargeEffect.SWEEP) wakeFlash = Triple(ChargeWake.SWEEP, DotKind.CHARGING.colour, SystemClock.uptimeMillis())
    ProbeLog.log(this, "aod", "charge wake, nothing near the sensor")
    launchAod(this, wake = true)
  }

  /** Unregisters the one-shot proximity listener and drops its wake lock; false when no read was running. */
  private fun stopChargeRead(): Boolean {
    val l = chargeRead ?: return false
    chargeRead = null
    main.removeCallbacks(chargeTimeout)
    getSystemService(SensorManager::class.java)?.unregisterListener(l)
    chargeLock?.takeIf { it.isHeld }?.release()
    chargeLock = null
    return true
  }

  // A plug-in is charging even if BatteryManager has not caught up with the broadcast yet.
  private fun chargeWakeAllowed(s: Settings) = aodPolicy.onNotificationWake(s.aod, aodState(this).apply { charging = true }, true)

  private fun notification(): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Halo", NotificationManager.IMPORTANCE_LOW))
    return Notification.Builder(this, CHANNEL)
      .setSmallIcon(Icon.createWithResource(this, applicationInfo.icon))
      .setContentTitle("Halo is running")
      .setOngoing(true)
      .build()
  }

  override fun onDestroy() {
    onSettings = null
    onListener = null
    onRetryWindow = null
    onFlash = null
    unregisterScreenOff()
    lightsOff()
    worker.shutdownNow()
    running = false
    state = null
    frameP95Ms = null
    ProbeLog.log(this, "service", "destroyed")
    publish()
  }

  companion object {
    const val MEDIA_PLAYBACK = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    const val SPECIAL_USE = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    private const val EXTRA_TYPE = "type"
    private const val EXTRA_PATH = "path"
    private const val CHANNEL = "halo_running"
    private const val NOTIFICATION_ID = 7001
    private const val BANDS = 32
    private const val RANDOM_SEED = 0x4A10
    private const val RANDOM_CHECK_MS = 3_050L
    private const val WAKE_FLASH_MS = 5_000L
    private const val PROXIMITY_TIMEOUT_MS = 500L

    @Volatile var running = false
      private set

    /** Set when the owner presses Stop, so the app-open restart does not undo it; a new process starts false. */
    @Volatile var stoppedByUser = false

    /** Main thread only: the screen-off receiver and AodActivity both run there. */
    val aodPolicy = AodPolicy()
    @Volatile var onChange: (() -> Unit)? = null

    /** Latest settings; the overlay reads this each frame and `onSettings` fires when it changes. */
    @Volatile var settings = Settings()
      private set
    @Volatile var onSettings: ((Settings) -> Unit)? = null

    fun applySettings(s: Settings) {
      settings = s
      onSettings?.invoke(s)
    }

    /** True while a settings screen is open: the lights show even when switched off, with random motion if nothing plays. */
    @Volatile var preview = false
      private set

    fun setPreview(ctx: Context, on: Boolean) {
      preview = on
      if (running) applySettings(settings) else if (on) start(ctx, MEDIA_PLAYBACK, "preview")
    }

    @Volatile var onListener: (() -> Unit)? = null

    @Volatile private var onRetryWindow: (() -> Unit)? = null

    /** Called when the app comes to the front: adds the lights window if an earlier add failed. */
    fun retryWindow() {
      onRetryWindow?.invoke()
    }

    // Main thread only, like the overlays.
    @Volatile private var onFlash: ((FlashDecision, Int) -> Boolean)? = null
    private val flashMain by lazy { Handler(Looper.getMainLooper()) }
    private var flashOnly: EdgeOverlay? = null
    private var flashOnlyUntil = 0L
    private val flashOnlyEnd = Runnable { flashOnly?.remove(); flashOnly = null }
    private val silent = SpectrumFrame(FloatArray(BANDS), 0f, false)
    private val flashSource = object : EdgeView.Source {
      override fun animate(nowMs: Long) = false
      override fun spectrum(nowMs: Long) = silent
    }

    /** Settings for code that may run without the service (listener, activities). */
    fun current(ctx: Context): Settings = if (running) settings else SettingsStore.load(ctx.applicationContext)

    /** Set while AodActivity is in front; a screen-off then is the power button, and this ends it. Main thread. */
    var aodClose: (() -> Unit)? = null
    val aodShowing: Boolean get() = aodClose != null

    /** Live inputs of the always-on decisions: lock, charger, music (read directly, so it works with the lights off) and the clock. */
    fun aodState(ctx: Context): AodState {
      val now = LocalTime.now()
      return AodState(
        keyguardLocked = ctx.getSystemService(KeyguardManager::class.java).isKeyguardLocked,
        charging = ctx.getSystemService(BatteryManager::class.java).isCharging,
        musicPlaying = MediaWatch.isPlaying(ctx),
        minuteOfDay = now.hour * 60 + now.minute,
      )
    }

    /** Set while AodActivity shows: the system hides the overlay over the keyguard, so flashes go to its own edge. Main thread. */
    var aodFlash: ((FlashDecision, Int) -> Unit)? = null
    private var wakeFlash: Triple<FlashDecision, Int, Long>? = null

    fun launchAod(ctx: Context, wake: Boolean) {
      try {
        ctx.startActivity(Intent(ctx, AodActivity::class.java).putExtra(AodActivity.EXTRA_WAKE, wake).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        ProbeLog.log(ctx, "aod", "startActivity returned without exception wake=$wake")
      } catch (e: Exception) {
        ProbeLog.log(ctx, "aod", "launch FAILED ${e.javaClass.name}: ${e.message}")
      }
    }

    /** A notification or reminder wakes the always-on screen for 10 s (design §2.3, §10.3), only over a locked, dark screen, inside its trigger and outside off hours. Main thread. */
    fun wake(ctx: Context, d: FlashDecision, colour: Int, why: String) {
      val app = ctx.applicationContext
      val s = current(app)
      if (!s.notify.wakeScreen || !s.aod.enabled) return
      // Screen on (the always-on screen itself, or the lock screen in use): the flash already shows there.
      if (app.getSystemService(PowerManager::class.java).isInteractive) return
      val st = aodState(app)
      if (!aodPolicy.onNotificationWake(s.aod, st, s.notify.wakeScreen)) {
        ProbeLog.log(app, "aod", "$why wake skipped: locked=${st.keyguardLocked} charging=${st.charging} music=${st.musicPlaying} trigger=${s.aod.trigger.key} minute=${st.minuteOfDay}")
        return
      }
      wakeFlash = Triple(d, colour, SystemClock.uptimeMillis())
      ProbeLog.log(app, "aod", "$why wake pkg=${d.pkg}")
      launchAod(app, wake = true)
    }

    /** The flash that woke the screen, replayed once the always-on edge exists. */
    fun takeWakeFlash(): Pair<FlashDecision, Int>? {
      val w = wakeFlash ?: return null
      wakeFlash = null
      return if (SystemClock.uptimeMillis() - w.third < WAKE_FLASH_MS) w.first to w.second else null
    }

    /** Flashes over the lights; when they are not shown, in a window of its own for the flash's duration. */
    fun flash(ctx: Context, d: FlashDecision, colour: Int) {
      val app = ctx.applicationContext
      flashMain.post {
        val s = current(app)
        if (!s.notify.enabled) return@post
        aodFlash?.let { it(d, colour); return@post }
        if (onFlash?.invoke(d, colour) == true) return@post
        val st = RuleInputs.snapshot(app)
        if (Rules.hidden(s.rules, st)) {
          ProbeLog.log(app, "rules", "flash skipped pkg=${d.pkg} call=${st.inCall} saver=${st.batterySaver} landscape=${st.landscape}")
          return@post
        }
        val o = flashOnly ?: EdgeOverlay(app, flashSource).takeIf { it.add() }?.also {
          it.apply(s, Patterns.create(s.pattern), IntArray(0))
          flashOnly = it
        } ?: return@post
        o.flash(d, colour)
        flashOnlyUntil = maxOf(flashOnlyUntil, SystemClock.uptimeMillis() + d.durationMs)
        flashMain.removeCallbacks(flashOnlyEnd)
        flashMain.postAtTime(flashOnlyEnd, flashOnlyUntil + 100)
      }
    }

    /** "ok", "blocked" or "idle"; idle whenever the service is not running. */
    @Volatile var audio = "idle"
      private set
    @Volatile var playingApp: String? = null
      private set
    @Volatile var frameP95Ms: Double? = null

    fun typeName(type: Int) = when (type) {
      MEDIA_PLAYBACK -> "mediaPlayback"
      SPECIAL_USE -> "specialUse"
      else -> "type$type"
    }

    /** Every start path goes through here so its outcome, success or exception, lands in the probe log. */
    fun start(ctx: Context, type: Int, path: String) {
      try {
        ctx.startForegroundService(Intent(ctx, HaloService::class.java).putExtra(EXTRA_TYPE, type).putExtra(EXTRA_PATH, path))
        ProbeLog.log(ctx, "start", "startForegroundService accepted path=$path type=${typeName(type)}")
      } catch (e: Exception) {
        ProbeLog.log(ctx, "start", "startForegroundService FAILED path=$path type=${typeName(type)} ${e.javaClass.name}: ${e.message}")
      }
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, HaloService::class.java))
    }
  }
}
