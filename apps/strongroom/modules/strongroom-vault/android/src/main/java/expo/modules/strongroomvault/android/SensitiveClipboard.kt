package expo.modules.strongroomvault.android

import android.app.Activity
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.view.ViewTreeObserver
import expo.modules.strongroomvault.core.ClipClear
import expo.modules.strongroomvault.core.ClipClear.Step
import java.util.UUID

/** Copies a secret marked sensitive and clears it after 30 s, unless something else was copied since. */
internal object SensitiveClipboard {
  private const val MARKER = "expo.modules.strongroomvault.clip"
  private const val TOKEN = "clipToken"
  private const val COPIED_AT = "clipCopiedAt"
  private const val JOB_ID = 0x5352434C
  private val main = Handler(Looper.getMainLooper())

  @Synchronized
  fun copy(context: Context, text: String) {
    val app = context.applicationContext
    val token = UUID.randomUUID().toString()
    VaultHolder.prefs(app).edit().putString(TOKEN, token).putLong(COPIED_AT, System.currentTimeMillis()).commit() // on disk first: a clear in a later process needs the token
    val clip = ClipData.newPlainText("Strongroom", text)
    clip.description.extras = PersistableBundle().apply {
      putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
      putString(MARKER, token)
    }
    app.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
    arm(app, ClipClear.AFTER_MS)
  }

  @Synchronized
  fun clearDue(context: Context) {
    val prefs = VaultHolder.prefs(context)
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    apply(ClipClear.due(prefs.getString(TOKEN, null), seen(clipboard)), prefs, clipboard)
  }

  fun whenFocused(activity: Activity) {
    val app = activity.applicationContext
    val decor = activity.window.decorView
    // Android hides the clipboard even from the app on screen until its window has focus.
    if (decor.hasWindowFocus()) return clearLeftOver(app)
    decor.viewTreeObserver.addOnWindowFocusChangeListener(object : ViewTreeObserver.OnWindowFocusChangeListener {
      override fun onWindowFocusChanged(hasFocus: Boolean) {
        if (!hasFocus) return
        decor.viewTreeObserver.removeOnWindowFocusChangeListener(this)
        clearLeftOver(app)
      }
    })
  }

  @Synchronized
  private fun clearLeftOver(context: Context) {
    val prefs = VaultHolder.prefs(context)
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    val copiedAt = prefs.getLong(COPIED_AT, 0)
    val now = System.currentTimeMillis()
    when (val step = ClipClear.focused(prefs.getString(TOKEN, null), seen(clipboard), copiedAt, now)) {
      Step.WAIT -> arm(context, ClipClear.left(copiedAt, now)) // the process that set the timer may be gone
      else -> apply(step, prefs, clipboard)
    }
  }

  private fun seen(clipboard: ClipboardManager): String? = clipboard.primaryClipDescription?.let { it.extras?.getString(MARKER).orEmpty() }

  private fun apply(step: Step, prefs: SharedPreferences, clipboard: ClipboardManager) {
    if (step == Step.CLEAR) clipboard.clearPrimaryClip() // a write, which Android allows from the background
    if (step == Step.CLEAR || step == Step.FORGET) prefs.edit().remove(TOKEN).remove(COPIED_AT).apply()
  }

  // The timer is exact while the process lives; the job runs the same clear after Android kills it.
  private fun arm(context: Context, delayMs: Long) {
    main.removeCallbacksAndMessages(null)
    main.postDelayed({ clearDue(context) }, delayMs)
    context.getSystemService(JobScheduler::class.java)
      .schedule(JobInfo.Builder(JOB_ID, ComponentName(context, ClipboardClearJob::class.java)).setMinimumLatency(delayMs).build())
  }
}

class ClipboardClearJob : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    SensitiveClipboard.clearDue(this)
    return false
  }

  override fun onStopJob(params: JobParameters): Boolean = false
}
