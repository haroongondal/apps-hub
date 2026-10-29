package expo.modules.deputyagent.android

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.coroutines.resume
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** FR-6: the Stop control over every app, in an accessibility overlay window (no SYSTEM_ALERT_WINDOW). Views are touched on the main thread only. */
object StopChip {
  private val main = Handler(Looper.getMainLooper())
  private var view: View? = null
  private var manager: WindowManager? = null
  private var label: TextView? = null
  private var params: WindowManager.LayoutParams? = null
  @Volatile private var colors: Map<String, Int> = emptyMap()

  fun setPalette(json: String) {
    colors = Json.parseToJsonElement(json).jsonObject.mapNotNull { (k, v) -> runCatching { k to Color.parseColor(v.jsonPrimitive.content) }.getOrNull() }.toMap()
  }

  fun show(s: AccessibilityService) = main.post {
    remove()
    val dp = s.resources.displayMetrics.density
    val c = colors
    val step = TextView(s).apply {
      text = "Deputy"
      textSize = 14f
      c["text"]?.let(::setTextColor)
      setPadding((12 * dp).toInt(), 0, (8 * dp).toInt(), 0)
    }
    val stop = TextView(s).apply {
      text = "Stop"
      textSize = 14f
      minHeight = (48 * dp).toInt()
      minWidth = (64 * dp).toInt()
      gravity = Gravity.CENTER
      c["onAccent"]?.let(::setTextColor)
      background = GradientDrawable().apply { cornerRadius = 24 * dp; setColor(c["accent"] ?: Color.DKGRAY) }
      contentDescription = "Stop Deputy's task"
      setOnClickListener { AgentRuntime.stop() }
    }
    val chip = LinearLayout(s).apply {
      gravity = Gravity.CENTER_VERTICAL
      setPadding((4 * dp).toInt(), (4 * dp).toInt(), (4 * dp).toInt(), (4 * dp).toInt())
      background = GradientDrawable().apply { cornerRadius = 28 * dp; setColor(c["raised"] ?: Color.BLACK) }
      addView(step)
      addView(stop)
    }
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = (8 * dp).toInt()
      y = (56 * dp).toInt()
    }
    val wm = s.getSystemService(WindowManager::class.java)
    if (runCatching { wm.addView(chip, lp) }.isSuccess) {
      view = chip
      manager = wm
      label = step
      params = lp
    }
  }

  fun step(n: Int) = main.post { label?.text = "Step $n" }

  fun hide() = main.post { remove() }

  /** Out of screenshots (SPEC §5) and out of the way of gestures, which land on the topmost touchable window. */
  suspend fun <T> hiddenFor(block: suspend () -> T): T {
    onMain { aside(true) }
    try {
      delay(80)
      return block()
    } finally {
      withContext(NonCancellable) { onMain { aside(false) } }
    }
  }

  private fun aside(on: Boolean) {
    val v = view ?: return
    val p = params ?: return
    v.visibility = if (on) View.INVISIBLE else View.VISIBLE
    val untouchable = WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    p.flags = if (on) p.flags or untouchable else p.flags and untouchable.inv()
    runCatching { manager?.updateViewLayout(v, p) }
  }

  private suspend fun onMain(block: () -> Unit) = suspendCancellableCoroutine { c ->
    main.post {
      block()
      c.resume(Unit)
    }
  }

  private fun remove() {
    view?.let { v -> runCatching { manager?.removeView(v) } }
    view = null
    manager = null
    label = null
    params = null
  }
}
