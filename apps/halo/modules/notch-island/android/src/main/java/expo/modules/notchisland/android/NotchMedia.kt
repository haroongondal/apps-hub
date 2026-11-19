package expo.modules.notchisland.android

import android.app.PendingIntent
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import expo.modules.notchisland.core.ProgressSnapshot

data class MediaInfo(val title: String?, val artist: String?, val art: Bitmap?, val playing: Boolean)

// actions: the call notification's action PendingIntents, by position. Never their titles.
data class CallInfo(val startedAt: Long, val actionCount: Int, val key: String, val actions: List<PendingIntent>)

/** State the notification listener feeds and the island reads. */
object NotchMedia {
  @Volatile var media: MediaInfo? = null
  @Volatile var call: CallInfo? = null
  @Volatile var progress: ProgressSnapshot? = null
  @Volatile var onChange: (() -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())

  fun changed() {
    main.post { onChange?.invoke() }
  }
}
