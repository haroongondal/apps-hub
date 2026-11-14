package expo.modules.clipboardcore.android

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import expo.modules.clipboardcore.core.BubblePlace
import expo.modules.clipboardcore.core.Swipe
import org.json.JSONObject

private const val PREFS = "clip_store"
private const val PALETTES = "palettes"
private const val BUBBLE_DX = "bubble_dx"
private const val BUBBLE_DY = "bubble_dy"
private const val PANEL_LIMIT = 50
private const val UNDO_MS = 5000L
private val DELETE_ACTION = View.generateViewId()

/** The bubble above the keyboard and its clip list, in accessibility overlays that never take focus from the field. Main thread only. */
object Bubble {
  private val main = Handler(Looper.getMainLooper())
  private var service: AccessibilityService? = null
  private var wm: WindowManager? = null
  private var above = 0
  private var screenW = 0
  private var screenH = 0
  private var dx = 0
  private var dy = 0
  private var bubble: View? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var panel: View? = null
  private var panelParams: WindowManager.LayoutParams? = null
  private var undo: View? = null
  private var pending: Clip? = null
  private val commitLater = Runnable { commit() }

  fun savePalettes(context: Context, json: String) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PALETTES, json).apply()

  fun update(s: AccessibilityService, keyboardTop: Int?) {
    if (keyboardTop == null) return hide()
    val m = s.getSystemService(WindowManager::class.java)
    val dp = s.resources.displayMetrics.density
    service = s
    wm = m
    val bounds = m.currentWindowMetrics.bounds
    screenW = bounds.width()
    screenH = bounds.height()
    above = screenH - keyboardTop
    val size = (48 * dp).toInt()
    spot(s, dp).let { (sx, sy) ->
      BubblePlace.clamped(sx, sy, screenW, above, screenH, size, statusTop(s)).let { (cx, cy) -> apply(cx, cy) }
    }
    val bp = bubbleParams
    if (bp != null) {
      panelParams?.let { move(panel, it, above + (8 * dp).toInt()) }
      return
    }
    val view = ImageView(s).apply {
      setImageDrawable(s.packageManager.getApplicationIcon(s.packageName))
      contentDescription = "Open Clipboard history"
      setOnClickListener { if (panel == null) openPanel() else closePanel() }
    }
    val lp = overlay(size, size).apply {
      x = dx
      y = above + dy
    }
    if (runCatching { m.addView(view, lp) }.isSuccess) {
      bubble = view
      bubbleParams = lp
      draggable(view, size)
    }
  }

  fun hide() {
    closePanel()
    bubble?.let { v -> runCatching { wm?.removeView(v) } }
    bubble = null
    bubbleParams = null
  }

  /** The user's dragged spot, or the design's default: 8 dp in from the right edge, 72 dp above the keyboard. */
  private fun spot(s: Context, dp: Float): Pair<Int, Int> {
    val prefs = s.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val x = prefs.getInt(BUBBLE_DX, -1)
    val y = prefs.getInt(BUBBLE_DY, -1)
    return if (x >= 0 && y >= 0) x to y else (8 * dp).toInt() to (72 * dp).toInt()
  }

  /** The status bar's height, so a parked bubble stays tappable under it; 0 when the system won't say. */
  private fun statusTop(s: Context): Int = runCatching {
    s.resources.getDimensionPixelSize(s.resources.getIdentifier("status_bar_height", "dimen", "android"))
  }.getOrDefault(0)

  /** Puts the bubble at its distances from the right edge and the keyboard top. */
  private fun apply(dxNew: Int, dyNew: Int) {
    dx = dxNew
    dy = dyNew
    val p = bubbleParams ?: return
    val y = above + dyNew
    if (p.x == dxNew && p.y == y) return
    p.x = dxNew
    p.y = y
    runCatching { wm?.updateViewLayout(bubble, p) }
  }

  /** Keeps the dragged spot for the next keyboards and after a restart. */
  private fun save() {
    service?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()
      ?.putInt(BUBBLE_DX, dx)?.putInt(BUBBLE_DY, dy)?.apply()
  }

  /** Drag moves the bubble anywhere on screen (BubblePlace clamps it: on screen, under the status bar, never under the keyboard); a tap without a drag opens the panel as before. */
  private fun draggable(v: View, size: Int) {
    val slop = ViewConfiguration.get(v.context).scaledTouchSlop
    val top = statusTop(v.context)
    var downX = 0f
    var downY = 0f
    var baseDx = 0
    var baseDy = 0
    var dragging = false
    v.setOnTouchListener { view, e ->
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX
          downY = e.rawY
          baseDx = dx
          baseDy = dy
          dragging = false
        }
        MotionEvent.ACTION_MOVE -> {
          val dxF = e.rawX - downX
          val dyF = e.rawY - downY
          if (!dragging && BubblePlace.isDrag(dxF, dyF, slop)) dragging = true
          if (dragging) {
            BubblePlace.dragged(baseDx, baseDy, dxF, dyF).let { (nx, ny) ->
              BubblePlace.clamped(nx, ny, screenW, above, screenH, size, top).let { (cx, cy) -> apply(cx, cy) }
            }
          }
        }
        MotionEvent.ACTION_UP -> if (dragging) save() else view.performClick()
        MotionEvent.ACTION_CANCEL -> if (dragging) save()
      }
      true
    }
  }

  private fun openPanel() {
    val s = service ?: return
    val m = wm ?: return
    val c = colors(s)
    val dp = s.resources.displayMetrics.density
    val px = { v: Int -> (v * dp).toInt() }

    val list = LinearLayout(s).apply { orientation = LinearLayout.VERTICAL }
    val clips = ClipStore.get(s).recent(PANEL_LIMIT).filter { it.kind == "text" }
    if (clips.isEmpty()) list.addView(label(s, "Nothing to paste yet. Copy something first.", 15f, c["muted"]).apply { setPadding(px(16), px(12), px(16), px(12)) })
    val now = System.currentTimeMillis()
    clips.forEachIndexed { i, clip ->
      if (i > 0) list.addView(View(s).apply { setBackgroundColor(c["line"] ?: Color.LTGRAY) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
      list.addView(row(s, c, clip, now, px))
    }
    val maxHeight = minOf(px(360), m.currentWindowMetrics.bounds.height() - above - px(96))
    val scroll = object : ScrollView(s) {
      override fun onMeasure(w: Int, h: Int) = super.onMeasure(w, MeasureSpec.makeMeasureSpec(maxHeight, MeasureSpec.AT_MOST))
    }.apply { addView(list) }

    val undoButton = button(s, "Undo", c["accent"], px).apply {
      visibility = View.GONE
      setOnClickListener {
        main.removeCallbacks(commitLater)
        pending = null
        closePanel()
        openPanel()
      }
    }
    val header = LinearLayout(s).apply {
      gravity = Gravity.CENTER_VERTICAL
      setPadding(px(16), 0, px(4), 0)
      addView(label(s, "Tap to paste, swipe to delete", 13f, c["muted"]), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
      addView(undoButton)
      addView(button(s, "Close", c["text"], px).apply { setOnClickListener { closePanel() } })
    }
    val root = LinearLayout(s).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        cornerRadius = 16 * dp
        setColor(c["surface"] ?: Color.WHITE)
        setStroke(1, c["line"] ?: Color.LTGRAY)
      }
      clipToOutline = true
      addView(header)
      addView(scroll)
      setOnTouchListener { _, e -> if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) closePanel(); false }
    }
    val lp = overlay(m.currentWindowMetrics.bounds.width() - px(24), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
      flags = flags or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
      x = px(12)
      y = above + px(8)
    }
    if (runCatching { m.addView(root, lp) }.isSuccess) {
      panel = root
      panelParams = lp
      undo = undoButton
    }
  }

  private fun closePanel() {
    commit()
    panel?.let { v -> runCatching { wm?.removeView(v) } }
    panel = null
    panelParams = null
    undo = null
  }

  private fun row(s: Context, c: Map<String, Int>, clip: Clip, now: Long, px: (Int) -> Int): View {
    val content = LinearLayout(s).apply {
      orientation = LinearLayout.VERTICAL
      minimumHeight = px(48)
      setPadding(px(16), px(10), px(16), px(10))
      setBackgroundColor(c["surface"] ?: Color.WHITE)
      addView(label(s, clip.text ?: "", 16f, c["text"]).apply {
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
      })
      addView(label(s, Swipe.ago(clip.at, now), 13f, c["muted"]))
    }
    val under = LinearLayout(s).apply {
      gravity = Gravity.CENTER_VERTICAL
      setPadding(px(16), 0, px(16), 0)
      setBackgroundColor(c["dangerSoft"] ?: Color.LTGRAY)
      addView(label(s, "Delete", 15f, c["danger"]), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
      addView(label(s, "Delete", 15f, c["danger"]))
    }
    val wrapper = FrameLayout(s).apply {
      addView(under, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      addView(content)
    }
    content.contentDescription = clip.text
    content.setOnClickListener { paste(clip) }
    content.accessibilityDelegate = object : View.AccessibilityDelegate() {
      override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(host, info)
        info.addAction(AccessibilityNodeInfo.AccessibilityAction(DELETE_ACTION, "Delete"))
      }

      override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
        if (action != DELETE_ACTION) return super.performAccessibilityAction(host, action, args)
        delete(clip, wrapper)
        return true
      }
    }
    swipeable(content) { delete(clip, wrapper) }
    return wrapper
  }

  private fun swipeable(v: View, onDelete: () -> Unit) {
    val slop = ViewConfiguration.get(v.context).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var dragging = false
    var tracker: VelocityTracker? = null
    v.setOnTouchListener { view, e ->
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX
          downY = e.rawY
          dragging = false
          tracker = VelocityTracker.obtain().also { it.addMovement(e) }
        }
        MotionEvent.ACTION_MOVE -> {
          tracker?.addMovement(e)
          val dx = e.rawX - downX
          if (!dragging && Swipe.isSwipe(dx, e.rawY - downY, slop)) {
            dragging = true
            view.parent.requestDisallowInterceptTouchEvent(true)
          }
          if (dragging) view.translationX = dx
        }
        MotionEvent.ACTION_UP -> {
          tracker?.run { addMovement(e); computeCurrentVelocity(1000) }
          val dir = if (dragging) Swipe.direction(e.rawX - downX, tracker?.xVelocity ?: 0f, view.width) else 0
          when {
            dir != 0 -> view.animate().translationX(dir * view.width.toFloat()).setDuration(150).withEndAction(onDelete)
            dragging -> view.animate().translationX(0f).setDuration(150)
            else -> view.performClick()
          }
          tracker?.recycle()
          tracker = null
        }
        MotionEvent.ACTION_CANCEL -> {
          view.animate().translationX(0f).setDuration(150)
          tracker?.recycle()
          tracker = null
        }
      }
      true
    }
  }

  // The row disappears at once; the clip is only removed when Undo times out or the panel closes.
  private fun delete(clip: Clip, row: View) {
    commit()
    pending = clip
    (row.parent as? ViewGroup)?.removeView(row)
    undo?.visibility = View.VISIBLE
    main.postDelayed(commitLater, UNDO_MS)
  }

  private fun commit() {
    main.removeCallbacks(commitLater)
    val clip = pending ?: return
    pending = null
    undo?.visibility = View.GONE
    service?.let { ClipStore.get(it).remove(clip.id) }
    ClipStore.onAdded?.invoke()
  }

  private fun paste(clip: Clip) {
    val s = service ?: return
    val text = ClipStore.get(s).reuse(clip.id) ?: return
    s.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Clipboard", text))
    closePanel()
    val pasted = s.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.performAction(AccessibilityNodeInfo.ACTION_PASTE) == true
    if (!pasted) Toast.makeText(s, "Copied. Paste it from the keyboard's suggestion.", Toast.LENGTH_SHORT).show()
  }

  private fun colors(s: Context): Map<String, Int> {
    val json = s.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PALETTES, null) ?: return emptyMap()
    val dark = (s.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val p = runCatching { JSONObject(json).getJSONObject(if (dark) "dark" else "light") }.getOrNull() ?: return emptyMap()
    return p.keys().asSequence().mapNotNull { k -> runCatching { k to Color.parseColor(p.getString(k)) }.getOrNull() }.toMap()
  }

  private fun label(s: Context, text: String, size: Float, color: Int?) = TextView(s).apply {
    this.text = text
    textSize = size
    color?.let(::setTextColor)
  }

  private fun button(s: Context, text: String, color: Int?, px: (Int) -> Int) = label(s, text, 15f, color).apply {
    gravity = Gravity.CENTER
    minHeight = px(48)
    minWidth = px(64)
    setPadding(px(12), 0, px(12), 0)
  }

  private fun overlay(width: Int, height: Int) = WindowManager.LayoutParams(
    width,
    height,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
    PixelFormat.TRANSLUCENT,
  ).apply { gravity = Gravity.BOTTOM or Gravity.END }

  private fun move(v: View?, p: WindowManager.LayoutParams, y: Int) {
    if (v == null || p.y == y) return
    p.y = y
    runCatching { wm?.updateViewLayout(v, p) }
  }
}
