package expo.modules.designmedia.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.SurfaceView
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.transformer.CompositionPlayer
import expo.modules.designmedia.core.ComposePlan
import expo.modules.designmedia.core.decodePlan
import expo.modules.designmedia.core.durationMs
import expo.modules.designmedia.core.fitInside
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToLong
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

// "Make a video" preview: plays the same Composition the export writes, all on the main thread.
class CompositionView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onPosition by EventDispatcher()
  private val onEnded by EventDispatcher()
  private val onError by EventDispatcher()
  private val main = Handler(Looper.getMainLooper())
  private val surface = SurfaceView(context).also { addView(it) }
  private val player = CompositionPlayer.Builder(context).setLooper(Looper.getMainLooper()).build()
  private var planJson: String? = null
  private var shape = 16 to 9
  private val ticker = object : Runnable {
    override fun run() {
      onPosition(mapOf("timeS" to player.currentPosition / 1000.0))
      if (player.isPlaying) main.postDelayed(this, TICK_MS)
    }
  }

  init {
    player.setVideoSurfaceView(surface)
    player.addListener(
      object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
          main.removeCallbacks(ticker)
          ticker.run()
        }

        override fun onPlaybackStateChanged(state: Int) {
          if (state == Player.STATE_ENDED) onEnded(emptyMap())
        }

        override fun onPlayerError(error: PlaybackException) {
          Log.w(TAG, "preview failed", error)
          onError(emptyMap())
        }
      },
    )
  }

  fun setPlan(json: String?) {
    if (json == planJson) return
    planJson = json
    try {
      val plan = json?.let { decodePlan(Json.parseToJsonElement(it).jsonObject) as? ComposePlan }
      if (plan == null) {
        player.pause()
        return
      }
      shape = plan.width to plan.height
      placeSurface()
      player.setComposition(ComposeBuilder.composition(plan, preview = true), player.currentPosition.coerceIn(0, durationMs(plan)))
      player.prepare()
    } catch (e: Exception) {
      Log.w(TAG, "preview plan refused", e)
      onError(emptyMap())
    }
  }

  fun setPlaying(on: Boolean) {
    if (!on) return player.pause()
    if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
    player.play()
  }

  fun seekTo(timeS: Double) = player.seekTo((timeS * 1000).roundToLong().coerceAtLeast(0))

  fun setScrubbing(on: Boolean) = player.setScrubbingModeEnabled(on)

  fun release() {
    main.removeCallbacks(ticker)
    player.release()
  }

  // React Native sizes this view but not views added natively, so the surface is placed by hand, black bars around it.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = placeSurface()

  private fun placeSurface() {
    val (w, h) = fitInside(width, height, shape.first, shape.second)
    val left = (width - w) / 2
    val top = (height - h) / 2
    surface.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    surface.layout(left, top, left + w, top + h)
  }

  private companion object {
    const val TAG = "DesignMediaPreview"
    const val TICK_MS = 100L
  }
}
