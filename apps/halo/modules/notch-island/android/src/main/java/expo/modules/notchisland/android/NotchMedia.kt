package expo.modules.notchisland.android

import android.app.PendingIntent
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import expo.modules.notchisland.core.AlarmSnapshot
import expo.modules.notchisland.core.ProgressSnapshot

data class MediaInfo(val title: String?, val artist: String?, val art: Bitmap?, val playing: Boolean)

// The call and alarm notifications' own action PendingIntents, in memory only while they last; null hides the button.
data class CallInfo(val startedAt: Long, val key: String, val speaker: PendingIntent?, val hangUp: PendingIntent?)

data class AlarmInfo(val snap: AlarmSnapshot, val snooze: PendingIntent?, val dismiss: PendingIntent?)

/** State the notification listener feeds and the island reads. */
object NotchMedia {
  @Volatile var media: MediaInfo? = null
  @Volatile var call: CallInfo? = null
  @Volatile var progress: ProgressSnapshot? = null
  @Volatile var alarm: AlarmInfo? = null
  @Volatile var onChange: (() -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())

  fun changed() {
    main.post { onChange?.invoke() }
  }
}
