package expo.modules.deputyagent.android

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.text.method.ScrollingMovementMethod
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.deputyagent.core.Gate
import expo.modules.deputyagent.core.GateCopy
import expo.modules.deputyagent.core.GateKind
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
  private var cardView: View? = null
  private var cardManager: WindowManager? = null
  private var cardParams: WindowManager.LayoutParams? = null
  private var cardLocked = false
  private var cardArmedAt = 0L
  private var lockWatch: Pair<Context, BroadcastReceiver>? = null
  private const val ARM_MS = 600L
  private const val CARD_LINES = 10
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

  fun hide() = main.post {
    remove()
    removeCard()
  }

  /** HyperOS drops the heads-up after 1–3 s and opened Deputy from a question's Answer (phone tests), so every gate waits here too; the paused run can't tap it. */
  fun gate(s: AccessibilityService, g: Gate) = main.post {
    removeCard()
    val dp = s.resources.displayMetrics.density
    val c = colors
    val question = g.kind == GateKind.QUESTION
    val body = TextView(s).apply {
      text = if (question) g.action else GateCopy.full(g)
      textSize = 14f
      maxLines = CARD_LINES
      isVerticalScrollBarEnabled = true
      movementMethod = ScrollingMovementMethod()
      c["text"]?.let(::setTextColor)
      setPadding(0, (4 * dp).toInt(), 0, (12 * dp).toInt())
    }
    fun button(label: String, filled: Boolean, onTap: () -> Unit) = TextView(s).apply {
      text = label
      textSize = 14f
      gravity = Gravity.CENTER
      minHeight = (48 * dp).toInt()
      minWidth = (96 * dp).toInt()
      (if (filled) c["onAccent"] else c["text"])?.let(::setTextColor)
      if (filled) background = GradientDrawable().apply { cornerRadius = 24 * dp; setColor(c["accent"] ?: Color.DKGRAY) }
      setOnClickListener { onTap() }
    }
    // A finger already moving when the card appeared mustn't approve or answer it.
    fun armed() = SystemClock.uptimeMillis() - cardArmedAt >= ARM_MS
    val card = LinearLayout(s).apply {
      orientation = LinearLayout.VERTICAL
      setPadding((16 * dp).toInt(), (12 * dp).toInt(), (16 * dp).toInt(), (12 * dp).toInt())
      background = GradientDrawable().apply { cornerRadius = 20 * dp; setColor(c["raised"] ?: Color.BLACK) }
      addView(TextView(s).apply {
        text = if (question) "Deputy has a question" else "Deputy needs your OK"
        textSize = 16f
        c["text"]?.let(::setTextColor)
      })
      addView(body)
    }
    val frame = FrameLayout(s).apply {
      setPadding((8 * dp).toInt(), 0, (8 * dp).toInt(), 0)
      addView(card)
    }
    if (question) {
      val reply = { text: String ->
        if (armed() && text.isNotBlank()) {
          // Gone before the run resumes: a focused card reads as Deputy in front, and the loop's backTo would press Back in the app.
          removeCard()
          AgentRuntime.resolveGate(s, g.id, approve = false, text = text.trim())
        }
      }
      g.options.forEach { o -> card.addView(button(o, filled = false) { reply(o) }) }
      val imm = s.getSystemService(InputMethodManager::class.java)
      val field = EditText(s).apply {
        hint = "Your answer"
        textSize = 14f
        minHeight = (48 * dp).toInt()
        c["text"]?.let(::setTextColor)
        c["muted"]?.let(::setHintTextColor)
        setOnFocusChangeListener { _, has -> if (has) typing(true) }
        viewTreeObserver.addOnWindowFocusChangeListener { focused -> if (focused && hasFocus()) imm.showSoftInput(this, 0) }
      }
      frame.setOnTouchListener { _, e ->
        if (e.action == MotionEvent.ACTION_OUTSIDE && field.hasFocus()) {
          imm.hideSoftInputFromWindow(field.windowToken, 0)
          field.clearFocus()
          typing(false)
        }
        false
      }
      card.addView(LinearLayout(s).apply {
        gravity = Gravity.CENTER_VERTICAL
        addView(field, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(button("Send", filled = true) { reply(field.text.toString()) }.apply { contentDescription = "Send your answer" })
      })
    } else {
      val deny = button("Deny", filled = false) { AgentRuntime.resolveGate(s, g.id, approve = false, text = null) }
      val approve = button("Approve", filled = true) {
        when {
          !armed() -> Unit
          locked(s) -> lockCard(true)
          else -> AgentRuntime.resolveGate(s, g.id, approve = true, text = null)
        }
      }
      deny.contentDescription = "Deny this step"
      approve.contentDescription = "Approve this step"
      // Like the collapsed row: a step too long to show whole is approved only where it can be read whole.
      body.post {
        if (body.lineCount > CARD_LINES) {
          approve.visibility = View.GONE
          body.text = "Too long to approve here. Open Deputy to read all of it and approve.\n\n${GateCopy.full(g)}"
        }
      }
      card.addView(LinearLayout(s).apply {
        gravity = Gravity.END
        addView(deny)
        addView(approve)
      })
    }
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      // Focusable only while the owner types (typing): focused, the card holds the keyboard and Back from the app; a tap outside gives them back.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or (if (question) WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH else 0),
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP
      y = (116 * dp).toInt()
    }
    val wm = s.getSystemService(WindowManager::class.java)
    if (runCatching { wm.addView(frame, lp) }.isSuccess) {
      cardView = frame
      cardManager = wm
      cardParams = lp
      // Like the notification's private version: the step and its message never show on the lock screen.
      lockCard(locked(s))
      val watch = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = lockCard(locked(s))
      }
      s.registerReceiver(watch, IntentFilter(Intent.ACTION_SCREEN_OFF).apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_USER_PRESENT) }, Context.RECEIVER_EXPORTED) // all three are protected broadcasts; SystemUI sends USER_PRESENT
      lockWatch = s to watch
    }
  }

  // USER_PRESENT doesn't come on a wake inside the lock delay, and the keyguard can lock while the screen is off.
  private fun locked(s: Context) = !s.getSystemService(PowerManager::class.java).isInteractive || s.getSystemService(KeyguardManager::class.java).isKeyguardLocked

  private fun lockCard(locked: Boolean) {
    if (cardLocked && !locked || cardArmedAt == 0L) cardArmedAt = SystemClock.uptimeMillis()
    cardLocked = locked
    aside(cardView, cardParams, cardManager, locked)
  }

  private fun typing(on: Boolean) {
    val v = cardView ?: return
    val p = cardParams ?: return
    val f = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
    p.flags = if (on) p.flags and f.inv() else p.flags or f
    runCatching { cardManager?.updateViewLayout(v, p) }
  }

  fun clearGate() = main.post { removeCard() }

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
    aside(view, params, manager, on)
    aside(cardView, cardParams, cardManager, on || cardLocked)
  }

  private fun aside(v: View?, p: WindowManager.LayoutParams?, wm: WindowManager?, on: Boolean) {
    if (v == null || p == null) return
    v.visibility = if (on) View.INVISIBLE else View.VISIBLE
    val untouchable = WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    p.flags = if (on) p.flags or untouchable else p.flags and untouchable.inv()
    runCatching { wm?.updateViewLayout(v, p) }
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

  private fun removeCard() {
    lockWatch?.let { (c, r) -> runCatching { c.unregisterReceiver(r) } }
    lockWatch = null
    cardLocked = false
    cardArmedAt = 0L
    cardView?.let { v -> runCatching { cardManager?.removeView(v) } }
    cardView = null
    cardManager = null
    cardParams = null
  }
}
