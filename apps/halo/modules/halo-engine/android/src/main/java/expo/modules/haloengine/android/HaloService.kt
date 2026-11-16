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
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import expo.modules.haloengine.core.Aod
import expo.modules.haloengine.core.AudioState
import expo.modules.haloengine.core.AudioWatch
import expo.modules.haloengine.core.ColorSource
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.Patterns
import expo.modules.haloengine.core.RandomMotion
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.Spectrum
import expo.modules.haloengine.core.SpectrumFrame
import java.util.concurrent.Executors

/** Foreground service that owns the audio tap, the playing state, the colours and the edge overlay; start paths still log to probe.log. */
class HaloService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var tap: AudioTap? = null
  private var overlay: EdgeOverlay? = null
  private var media: MediaWatch? = null
  private var screenOff: BroadcastReceiver? = null
  private var aodShownSinceUnlock = false

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
    // A listener reconnect leaves the old session watch empty, so it is rebuilt.
    onListener = { main.post { media?.run { stop(); start() } } }
    applySettings(SettingsStore.load(this))
    return START_NOT_STICKY
  }

  private fun now() = SystemClock.uptimeMillis()

  private fun apply(s: Settings) {
    if (!running) return
    val spike = SettingsStore.aodSpike(this)
    syncScreenOff(spike)
    if (!s.enabled && !preview) {
      lightsOff()
      ProbeLog.log(this, "service", "lights disabled")
      // The always-on spike needs the screen-off receiver, which lives as long as this service.
      if (!spike) stopSelf()
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
    // Assigned before start(): start() reports an already-playing session through onMedia, which reads `media`.
    media = MediaWatch(this, ::onMedia, ::recomputeColors)
    media?.start()
    runCatching { getSystemService(WallpaperManager::class.java).addOnColorsChangedListener(wallpaperListener, main) }
    startTap()
  }

  /** Retries only the window add while the lights are on but the window is missing (overlay access granted later). */
  private fun attachWindow() {
    val o = overlay ?: return
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
    overlay?.remove()
    overlay = null
    attempt = 0
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

  /** The screen-off receiver exists only while the Diagnostics switch "Test the always-on screen" is on. */
  private fun syncScreenOff(spike: Boolean) {
    if (spike && screenOff == null) {
      registerScreenOff()
      ProbeLog.log(this, "aod", "screen-off receiver registered")
    } else if (!spike && screenOff != null) {
      unregisterScreenOff()
      ProbeLog.log(this, "aod", "screen-off receiver removed")
    }
  }

  private fun unregisterScreenOff() {
    screenOff?.let { runCatching { unregisterReceiver(it) } }
    screenOff = null
  }

  private fun registerScreenOff() {
    aodShownSinceUnlock = false
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, i: Intent) {
        if (i.action == Intent.ACTION_USER_PRESENT) {
          aodShownSinceUnlock = false
          ProbeLog.log(context, "aod", "phone unlocked, the clock may show again")
          return
        }
        val spike = SettingsStore.aodSpike(context)
        val locked = context.getSystemService(KeyguardManager::class.java).isKeyguardLocked
        // Launching over an unlocked phone would cancel its pending lock, so the clock only covers a locked one.
        if (!Aod.shouldLaunch(spike, locked, aodShownSinceUnlock)) {
          val why = when {
            !spike -> "switch off"
            !locked -> "keyguard not locked"
            else -> "already shown since the last unlock"
          }
          ProbeLog.log(context, "aod", "aod skipped: $why")
          return
        }
        aodShownSinceUnlock = true
        ProbeLog.log(context, "aod", "SCREEN_OFF received, keyguard locked, launching AodActivity")
        try {
          context.startActivity(Intent(context, AodActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          ProbeLog.log(context, "aod", "startActivity returned without exception")
        } catch (e: Exception) {
          ProbeLog.log(context, "aod", "launch FAILED ${e.javaClass.name}: ${e.message}")
        }
      }
    }
    val filter = IntentFilter(Intent.ACTION_SCREEN_OFF).apply { addAction(Intent.ACTION_USER_PRESENT) }
    // SystemUI, not the system uid, sends USER_PRESENT, so a not-exported receiver never gets it; both actions are protected broadcasts, so no app can fake them.
    registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
    screenOff = r
  }

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

    @Volatile var running = false
      private set
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
