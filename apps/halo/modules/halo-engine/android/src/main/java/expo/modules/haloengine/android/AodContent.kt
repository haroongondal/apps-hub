package expo.modules.haloengine.android

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.haloengine.core.AodAction
import expo.modules.haloengine.core.AodGestures
import expo.modules.haloengine.core.AodScreen
import expo.modules.haloengine.core.BurnIn
import expo.modules.haloengine.core.ColorSource
import expo.modules.haloengine.core.FlashDecision
import expo.modules.haloengine.core.Patterns
import expo.modules.haloengine.core.RandomMotion
import expo.modules.haloengine.core.Settings
import expo.modules.haloengine.core.SpectrumFrame
import expo.modules.haloengine.core.Theme
import java.util.concurrent.Executors

class AodContent(
  ctx: Context,
  private val theme: Theme,
  private val settings: Settings,
  private val preview: Boolean,
  private val onLeave: () -> Unit,
) : FrameLayout(ctx) {
  private val main = Handler(Looper.getMainLooper())
  private val dp = resources.displayMetrics.density
  private val worker = Executors.newSingleThreadExecutor()
  private var colourGen = 0
  private val palette = theme.colours.palette.mapNotNull { runCatching { Color.parseColor(it) }.getOrNull() }.toIntArray()
    .takeIf { it.isNotEmpty() } ?: intArrayOf(Color.WHITE)

  private val frame = SpectrumFrame(FloatArray(BANDS), 0f, false)
  // shortcut: the theme's edge moves by itself (random motion), not with the music; feed it the service's spectrum if owners ask.
  private val source = object : EdgeView.Source {
    override fun animate(nowMs: Long) = theme.edge.on
    override fun spectrum(nowMs: Long): SpectrumFrame {
      RandomMotion.fill(frame.bands, nowMs, SEED)
      frame.level = frame.bands.average().toFloat()
      return frame
    }
  }

  private val content = FrameLayout(ctx)
  private val photo = ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP; visibility = GONE }
  private val dim = View(ctx).apply { setBackgroundColor(Color.BLACK); alpha = theme.dim.toFloat(); visibility = GONE }
  private val edge = EdgeView(ctx, source)
  private val face = FaceView(ctx)
  private val icons = LinearLayout(ctx).apply { gravity = Gravity.CENTER }
  private val art = ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true }
  private val title = text(16f, 0xEEFFFFFF.toInt())
  private val artist = text(13f, 0x99FFFFFF.toInt())
  private val card = LinearLayout(ctx).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    visibility = GONE
    background = GradientDrawable().apply { cornerRadius = 20 * dp; setColor(0x26FFFFFF) }
    setPadding((12 * dp).toInt(), (10 * dp).toInt(), (16 * dp).toInt(), (10 * dp).toInt())
  }
  private val bottom = LinearLayout(ctx).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER_HORIZONTAL
    setPadding((32 * dp).toInt(), 0, (32 * dp).toInt(), (40 * dp).toInt())
  }

  private val watch = MediaWatch(ctx, ::onMedia) {}
  private var controller: MediaController? = null
  private val mediaCallback = object : MediaController.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackState?) = showCard()
    override fun onMetadataChanged(metadata: MediaMetadata?) {
      showCard()
      if (theme.colours.source == ColorSource.ALBUM_ART) deriveColours()
    }
    override fun onSessionDestroyed() = setController(null)
  }

  private val sensors = ctx.getSystemService(SensorManager::class.java)
  private var pocket = false
  private val proximity = object : SensorEventListener {
    override fun onSensorChanged(e: SensorEvent) = setPocket(AodScreen.near(e.values[0], e.sensor.maximumRange))
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  }
  private val iconsHook: () -> Unit = { showIcons() }

  private val shift = FloatArray(2)
  private val burnIn = object : Runnable {
    override fun run() {
      val now = System.currentTimeMillis()
      BurnIn.offset(now, 12 * dp, shift)
      bottom.translationX = shift[0]
      bottom.translationY = shift[1]
      main.postDelayed(this, 60_000L - now % 60_000L)
    }
  }

  private val gestures = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(e: MotionEvent) = true
    override fun onDoubleTap(e: MotionEvent) = act(AodGestures.doubleTap(pocket))
    override fun onSingleTapConfirmed(e: MotionEvent) = act(AodGestures.singleTap(onCard(e), pocket, preview))
    override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
      val start = e1 ?: return false
      return act(AodGestures.fling(onCard(start), pocket, e2.x - start.x, e2.y - start.y, 48 * dp))
    }
  })

  init {
    setBackgroundColor(Color.BLACK)
    val match = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    val texts = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      addView(title)
      addView(artist)
    }
    card.addView(art, LinearLayout.LayoutParams((48 * dp).toInt(), (48 * dp).toInt()).apply { marginEnd = (12 * dp).toInt() })
    card.addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    art.background = GradientDrawable().apply { cornerRadius = 10 * dp; setColor(0x33FFFFFF) }
    bottom.addView(icons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    bottom.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = (16 * dp).toInt() })
    val column = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      addView(face, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
      addView(bottom, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }
    content.addView(photo, match)
    content.addView(dim, LayoutParams(match))
    content.addView(edge, LayoutParams(match))
    content.addView(column, LayoutParams(match))
    addView(content, LayoutParams(match))
    edge.apply(settings, Patterns.create(theme.edge.pattern), palette)
    edge.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> if (theme.edge.on && !pocket) edge.kick() }
    face.apply(theme.face, theme.faceOptions, palette)
    card.contentDescription = "Music. Tap to play or pause, swipe left for the next track, right for the previous."
  }

  fun flash(d: FlashDecision, colour: Int) {
    if (!pocket) edge.flash(d, colour)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    watch.start()
    if (!preview) sensors?.getDefaultSensor(Sensor.TYPE_PROXIMITY)?.let { sensors.registerListener(proximity, it, SensorManager.SENSOR_DELAY_NORMAL, main) }
    NotifyFlash.onIcons = iconsHook
    showIcons()
    burnIn.run()
    deriveColours()
    if (theme.photo) loadPhoto()
  }

  override fun onDetachedFromWindow() {
    main.removeCallbacks(burnIn)
    if (NotifyFlash.onIcons === iconsHook) NotifyFlash.onIcons = null
    sensors?.unregisterListener(proximity)
    setController(null)
    watch.stop()
    edge.stop()
    colourGen++
    worker.shutdownNow()
    super.onDetachedFromWindow()
  }

  override fun onTouchEvent(e: MotionEvent): Boolean {
    gestures.onTouchEvent(e)
    return true
  }

  private fun act(a: AodAction): Boolean {
    val tc = controller?.transportControls
    when (a) {
      AodAction.NONE -> return false
      AodAction.LEAVE -> onLeave()
      AodAction.PLAY_PAUSE -> if (controller?.playbackState?.state == PlaybackState.STATE_PLAYING) tc?.pause() else tc?.play()
      AodAction.NEXT -> tc?.skipToNext()
      AodAction.PREVIOUS -> tc?.skipToPrevious()
    }
    return true
  }

  private val loc = IntArray(2)
  private val cardLoc = IntArray(2)

  private fun onCard(e: MotionEvent): Boolean {
    if (card.visibility != VISIBLE) return false
    getLocationInWindow(loc)
    card.getLocationInWindow(cardLoc)
    val x = e.x + loc[0] - cardLoc[0]
    val y = e.y + loc[1] - cardLoc[1]
    return x >= 0 && y >= 0 && x < card.width && y < card.height
  }

  private fun setPocket(near: Boolean) {
    if (near == pocket) return
    pocket = near
    content.visibility = if (near) GONE else VISIBLE
    if (near) edge.stop() else if (theme.edge.on) edge.kick()
  }

  // A paused track keeps its card (so a tap can resume it) until its session ends.
  private fun onMedia() {
    val c = watch.playing ?: return
    if (c.sessionToken != controller?.sessionToken) setController(c)
  }

  private fun setController(c: MediaController?) {
    controller?.unregisterCallback(mediaCallback)
    controller = c
    c?.registerCallback(mediaCallback, main)
    showCard()
    if (theme.colours.source == ColorSource.ALBUM_ART) deriveColours()
  }

  private fun showCard() {
    val c = controller
    val meta = c?.metadata
    if (c == null) {
      card.visibility = GONE
      return
    }
    title.text = meta?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: ""
    artist.text = meta?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: meta?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: ""
    art.setImageBitmap(ART_KEYS.firstNotNullOfOrNull { meta?.getBitmap(it) })
    card.alpha = if (c.playbackState?.state == PlaybackState.STATE_PLAYING) 1f else 0.6f
    card.visibility = VISIBLE
  }

  private fun showIcons() {
    icons.removeAllViews()
    val pm = context.packageManager
    for (ic in NotifyFlash.icons()) {
      val drawable = runCatching { pm.getApplicationIcon(ic.pkg) }.getOrNull() ?: continue
      val label = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(ic.pkg, PackageManager.ApplicationInfoFlags.of(0))) }.getOrDefault(ic.pkg)
      val cell = FrameLayout(context).apply { contentDescription = "$label, ${ic.count} notification${if (ic.count == 1) "" else "s"}" }
      cell.addView(ImageView(context).apply { setImageDrawable(drawable) }, LayoutParams((28 * dp).toInt(), (28 * dp).toInt(), Gravity.CENTER))
      if (ic.count > 1) {
        cell.addView(
          text(10f, Color.BLACK).apply {
            text = if (ic.count > 9) "9+" else ic.count.toString()
            gravity = Gravity.CENTER
            minWidth = (16 * dp).toInt()
            background = GradientDrawable().apply { cornerRadius = 8 * dp; setColor(Color.WHITE) }
          },
          LayoutParams(LayoutParams.WRAP_CONTENT, (16 * dp).toInt(), Gravity.TOP or Gravity.END),
        )
      }
      icons.addView(cell, LinearLayout.LayoutParams((38 * dp).toInt(), (38 * dp).toInt()).apply { marginStart = (4 * dp).toInt(); marginEnd = (4 * dp).toInt() })
    }
  }

  private fun deriveColours() {
    val gen = ++colourGen
    val src = theme.colours.source
    val c = controller
    runCatching {
      worker.execute {
        val out = when (src) {
          ColorSource.ALBUM_ART -> Colours.albumArt(context, c)
          ColorSource.WALLPAPER -> Colours.wallpaper(context)
          ColorSource.PALETTE -> null
        } ?: palette
        main.post {
          if (gen != colourGen) return@post
          face.apply(theme.face, theme.faceOptions, out)
          edge.setColors(out)
        }
      }
    }
  }

  private fun loadPhoto() {
    val f = runCatching { Backgrounds.file(context, theme.id) }.getOrNull() ?: return
    runCatching {
      worker.execute {
        val bmp = runCatching { BitmapFactory.decodeFile(f.path) }.getOrNull() ?: return@execute
        main.post {
          if (!isAttachedToWindow) return@post
          photo.setImageBitmap(bmp)
          photo.visibility = VISIBLE
          dim.visibility = VISIBLE
        }
      }
    }
  }

  private fun text(sp: Float, colour: Int) = TextView(context).apply {
    textSize = sp
    setTextColor(colour)
    typeface = Fonts.get(context)[0]
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }

  companion object {
    private const val BANDS = 32
    private const val SEED = 0x40D
    private val ART_KEYS = listOf(MediaMetadata.METADATA_KEY_ALBUM_ART, MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_DISPLAY_ICON)

    fun fullScreen(w: Window) {
      w.attributes = w.attributes.apply { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS }
      w.setDecorFitsSystemWindows(false)
      w.insetsController?.let {
        it.hide(WindowInsets.Type.systemBars())
        it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
    }
  }
}
