package expo.modules.strongroomvault.android

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import java.util.UUID

/** Copies a secret marked sensitive and clears it after 30 s, unless something else was copied since. */
internal object SensitiveClipboard {
  private const val MARKER = "expo.modules.strongroomvault.clip"
  private const val CLEAR_AFTER_MS = 30_000L
  private val main = Handler(Looper.getMainLooper())

  fun copy(context: Context, text: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    val token = UUID.randomUUID().toString()
    val clip = ClipData.newPlainText("Strongroom", text)
    clip.description.extras = PersistableBundle().apply {
      putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
      putString(MARKER, token)
    }
    clipboard.setPrimaryClip(clip)
    main.postDelayed({
      // Since API 29 an app in the background reads null here; clearing then beats leaving a password behind.
      val current = clipboard.primaryClipDescription
      if (current == null || current.extras?.getString(MARKER) == token) clipboard.clearPrimaryClip()
    }, CLEAR_AFTER_MS)
  }
}
