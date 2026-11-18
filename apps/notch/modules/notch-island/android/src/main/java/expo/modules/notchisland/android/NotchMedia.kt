package expo.modules.notchisland.android

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper

data class MediaInfo(val title: String?, val artist: String?, val art: Bitmap?, val playing: Boolean)

data class CallInfo(val startedAt: Long, val actionCount: Int, val key: String)

/** State the notification listener feeds and the island reads. */
object NotchMedia {
  @Volatile var media: MediaInfo? = null
  @Volatile var call: CallInfo? = null
  @Volatile var onChange: (() -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())

  fun changed() {
    main.post { onChange?.invoke() }
  }
}
