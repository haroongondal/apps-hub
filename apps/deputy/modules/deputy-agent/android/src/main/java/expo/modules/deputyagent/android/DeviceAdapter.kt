package expo.modules.deputyagent.android

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import android.view.Display
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction
import android.view.accessibility.AccessibilityWindowInfo
import expo.modules.deputyagent.core.Action
import expo.modules.deputyagent.core.AgentLoop
import expo.modules.deputyagent.core.Area
import expo.modules.deputyagent.core.Bounds
import expo.modules.deputyagent.core.Button
import expo.modules.deputyagent.core.Device
import expo.modules.deputyagent.core.DeviceRules
import expo.modules.deputyagent.core.Direction
import expo.modules.deputyagent.core.NodeRef
import expo.modules.deputyagent.core.Screen
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

private const val SERVICE_OFF = "The accessibility service went off. Turn it on again in Setup."
private const val STALE = "stale_screen: that element changed or went away, so nothing was done. Look again."
private const val CANT_TYPE = "This field didn't take the text, so nothing was typed. Some apps (Flutter ones, for example) don't allow typing by accessibility. Say so and finish, or ask the owner."

/** `core/Device` over the accessibility service, looked up on every call because it can rebind mid-run (spikes S3, S9). */
class DeviceAdapter(private val context: Context) : Device {
  private var refs: List<NodeRef> = emptyList()
  private var infos: List<AccessibilityNodeInfo> = emptyList()
  private val appWindow = Rect()
  private var display = Bounds(0, 0, 0, 0)
  private var unread: List<Area> = emptyList()

  override suspend fun foregroundPkg(): String = awaitService().rootInActiveWindow?.packageName?.toString().orEmpty()

  override fun read(): Screen {
    val s = service()
    val windows = s.windows
    val active = windows.firstOrNull { it.isActive }
    val root = active?.root ?: s.rootInActiveWindow
    val refs = ArrayList<NodeRef>()
    val infos = ArrayList<AccessibilityNodeInfo>()
    root?.let { flatten(it, refs, infos) }
    val heading = infos.firstOrNull { it.isHeading && !it.text.isNullOrBlank() }?.text?.toString()
    // Other apps' windows (split screen, dialogs) are read too; System UI's (status bar, heads-up, shade) aren't.
    for (w in windows) if (w !== active && w.type == AccessibilityWindowInfo.TYPE_APPLICATION) w.root?.let { flatten(it, refs, infos) }
    this.refs = refs
    this.infos = infos
    unread = windows.filter { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD || it.type == AccessibilityWindowInfo.TYPE_SYSTEM }
      .map { w -> Area(w.root?.packageName?.toString().orEmpty(), Rect().also(w::getBoundsInScreen).let { Bounds(it.left, it.top, it.right, it.bottom) }) }
    active?.getBoundsInScreen(appWindow) ?: appWindow.setEmpty()
    display = s.getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds.let { Bounds(it.left, it.top, it.right, it.bottom) }
    val pkg = root?.packageName?.toString().orEmpty()
    val title = listOfNotNull(active?.title?.toString(), heading).filter { it.isNotBlank() }.distinct().joinToString(" · ")
    return Screen(pkg, label(pkg), title.ifEmpty { null }, windows.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }, display, refs, unread)
  }

  override suspend fun screenshot(): String? {
    val s = awaitService()
    if (blockedNotice()) return null
    val full = StopChip.hiddenFor { shoot(s) ?: run { delay(350); shoot(s) } } ?: return null
    delay(150)
    if (blockedNotice()) return null.also { full.recycle() }
    val scale = AgentLoop.SHOT_WIDTH.toFloat() / full.width
    val small = Bitmap.createScaledBitmap(full, AgentLoop.SHOT_WIDTH, (full.height * scale).toInt(), true)
    if (small !== full) full.recycle()
    try {
      if (blank(small, scale)) return null
      val out = ByteArrayOutputStream()
      small.compress(Bitmap.CompressFormat.JPEG, 70, out)
      return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } finally {
      small.recycle()
    }
  }

  override fun resolveApp(name: String): List<Pair<String, String>> =
    launcherApps(context).filter { (pkg, label) -> pkg == name || label.contains(name, ignoreCase = true) }

  override fun resolveLink(url: String): String? = context.packageManager
    .resolveActivity(linkIntent(url), PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.takeIf { it != "android" }

  override suspend fun perform(action: Action, target: NodeRef?): String {
    val s = awaitService()
    return when (action) {
      is Action.OpenApp -> start(s, context.packageManager.getLaunchIntentForPackage(action.pkg), "Opened ${label(action.pkg)}.")
      is Action.OpenLink -> start(s, linkIntent(action.url), "Opened the link.")
      is Action.Tap -> live(target) { n -> if (n.isClickable && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) "Tapped." else press(s, n, 50) }
      is Action.TapAt -> gesture(s, dot(action.x, action.y), 50)
      is Action.LongPress -> live(target) { n -> press(s, n, 700) }
      is Action.TypeText -> live(target) { n -> type(n, action) }
      is Action.Scroll -> if (target == null) gesture(s, stroke(DeviceRules.scrollLine(display, action.direction)), 300) else live(target) { n -> scroll(s, n, action.direction) }
      is Action.Swipe -> gesture(s, stroke(DeviceRules.line(display, action.direction)), 300)
      is Action.Press -> if (s.performGlobalAction(global(action.button))) "Pressed ${action.button.name.lowercase()}." else "The phone didn't press ${action.button.name.lowercase()}."
      is Action.Wait -> delay(action.seconds * 1_000L).let { "Waited ${action.seconds} s." }
      Action.Look -> "A screenshot comes with the next screen."
    }
  }

  override suspend fun settle() {
    awaitService()
    DeviceRules.settle({ DeputyAccessibilityService.lastEventAt }, SystemClock::elapsedRealtime)
  }

  private inline fun live(target: NodeRef?, act: (AccessibilityNodeInfo) -> String): String {
    val i = target?.let { DeviceRules.find(refs, it) } ?: return STALE
    val n = infos[i]
    if (!n.refresh() || DeviceRules.changed(refs[i], toRef(n, refs[i].depth))) return STALE
    return act(n)
  }

  private suspend fun type(n: AccessibilityNodeInfo, a: Action.TypeText): String {
    if (n.isPassword) return "denied: Deputy never types into password fields."
    val before = shownText(n)
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, before + a.text) }
    n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    delay(300)
    n.refresh()
    if (a.text.isNotEmpty() && shownText(n) == before) return CANT_TYPE
    if (a.pressEnter && !n.performAction(AccessibilityAction.ACTION_IME_ENTER.id)) return "Typed, but the field has no Enter action. Tap its send or search button instead."
    return "Typed."
  }

  private suspend fun press(s: AccessibilityService, n: AccessibilityNodeInfo, ms: Long): String {
    val r = Rect().also(n::getBoundsInScreen)
    if (unread.any { r.centerX() in it.bounds.left..it.bounds.right && r.centerY() in it.bounds.top..it.bounds.bottom }) {
      return "That element is under the keyboard or a system window, so nothing was tapped. Close it, then look again."
    }
    return gesture(s, dot(r.centerX(), r.centerY()), ms)
  }

  private fun blockedNotice() = SystemClock.elapsedRealtime() - DeputyAccessibilityService.blockedNoticeAt < DeputyAccessibilityService.HEADS_UP_MS

  private suspend fun scroll(s: AccessibilityService, n: AccessibilityNodeInfo, d: Direction): String {
    val exact = when (d) {
      Direction.UP -> AccessibilityAction.ACTION_SCROLL_UP
      Direction.DOWN -> AccessibilityAction.ACTION_SCROLL_DOWN
      Direction.LEFT -> AccessibilityAction.ACTION_SCROLL_LEFT
      Direction.RIGHT -> AccessibilityAction.ACTION_SCROLL_RIGHT
    }
    val step = if (d == Direction.UP || d == Direction.LEFT) AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
    if (n.performAction(exact.id) || n.performAction(step)) return "Scrolled."
    val r = Rect().also(n::getBoundsInScreen)
    return gesture(s, stroke(DeviceRules.scrollLine(Bounds(r.left, r.top, r.right, r.bottom), d)), 300)
  }

  private suspend fun gesture(s: AccessibilityService, path: Path, ms: Long): String = StopChip.hiddenFor {
    suspendCancellableCoroutine { c ->
      val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms)).build()
      val sent = s.dispatchGesture(
        g,
        object : AccessibilityService.GestureResultCallback() {
          override fun onCompleted(d: GestureDescription?) = c.resume("Done.")
          override fun onCancelled(d: GestureDescription?) = c.resume("The gesture was interrupted. Look again.")
        },
        null,
      )
      if (!sent) c.resume("The phone refused the gesture.")
    }
  }

  private suspend fun shoot(s: AccessibilityService): Bitmap? = withTimeoutOrNull(5_000) {
    suspendCancellableCoroutine { c ->
      s.takeScreenshot(
        Display.DEFAULT_DISPLAY,
        s.mainExecutor,
        object : AccessibilityService.TakeScreenshotCallback {
          override fun onSuccess(r: AccessibilityService.ScreenshotResult) {
            val buffer = r.hardwareBuffer
            val hardware = Bitmap.wrapHardwareBuffer(buffer, r.colorSpace)
            val copy = hardware?.copy(Bitmap.Config.ARGB_8888, false)
            hardware?.recycle()
            buffer.close()
            c.resume(copy)
          }

          override fun onFailure(code: Int) = c.resume(null)
        },
      )
    }
  }

  private fun blank(b: Bitmap, scale: Float): Boolean {
    val r = Rect((appWindow.left * scale).toInt(), (appWindow.top * scale).toInt(), (appWindow.right * scale).toInt(), (appWindow.bottom * scale).toInt())
    if (!r.intersect(0, 0, b.width, b.height) || r.isEmpty) return false
    return DeviceRules.isBlank(IntArray(144) { i -> b.getPixel(r.left + r.width() * (i % 12 * 2 + 1) / 24, r.top + r.height() * (i / 12 * 2 + 1) / 24) })
  }

  private fun start(s: AccessibilityService, intent: Intent?, done: String): String = try {
    if (intent == null) "That app has no screen to open." else done.also { s.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
  } catch (e: ActivityNotFoundException) {
    "No app on the phone opens that."
  }

  private fun label(pkg: String) = runCatching {
    context.packageManager.run { getApplicationLabel(getApplicationInfo(pkg, 0)).toString() }
  }.getOrDefault(pkg)

  private fun service() = DeputyAccessibilityService.instance ?: throw IllegalStateException(SERVICE_OFF)

  private suspend fun awaitService(): DeputyAccessibilityService {
    repeat(50) {
      DeputyAccessibilityService.instance?.let { return it }
      delay(100)
    }
    throw IllegalStateException(SERVICE_OFF)
  }
}

private fun shownText(n: AccessibilityNodeInfo) = if (n.isShowingHintText) "" else n.text?.toString().orEmpty()

private fun dot(x: Int, y: Int) = Path().apply { moveTo(x.toFloat(), y.toFloat()) }

private fun stroke(l: IntArray) = Path().apply {
  moveTo(l[0].toFloat(), l[1].toFloat())
  lineTo(l[2].toFloat(), l[3].toFloat())
}

private fun global(b: Button) = when (b) {
  Button.BACK -> AccessibilityService.GLOBAL_ACTION_BACK
  Button.HOME -> AccessibilityService.GLOBAL_ACTION_HOME
  Button.RECENTS -> AccessibilityService.GLOBAL_ACTION_RECENTS
  Button.NOTIFICATIONS -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
}

internal fun linkIntent(url: String): Intent {
  val uri = Uri.parse(url)
  return when (uri.scheme?.lowercase()) {
    "tel" -> Intent(Intent.ACTION_DIAL, uri)
    "sms", "smsto", "mailto" -> Intent(Intent.ACTION_SENDTO, uri)
    else -> Intent(Intent.ACTION_VIEW, uri)
  }
}

internal fun toRef(n: AccessibilityNodeInfo, depth: Int): NodeRef {
  val r = Rect().also(n::getBoundsInScreen)
  return NodeRef(
    pkg = n.packageName?.toString().orEmpty(),
    text = if (n.isShowingHintText) null else n.text?.toString(),
    desc = n.contentDescription?.toString(),
    hint = n.hintText?.toString(),
    viewId = n.viewIdResourceName,
    bounds = Bounds(r.left, r.top, r.right, r.bottom),
    clickable = n.isClickable,
    editable = n.isEditable,
    scrollable = n.isScrollable,
    password = n.isPassword,
    visible = n.isVisibleToUser,
    depth = depth,
  )
}

internal fun flatten(n: AccessibilityNodeInfo, refs: MutableList<NodeRef>, infos: MutableList<AccessibilityNodeInfo>? = null, depth: Int = 0) {
  refs += toRef(n, depth)
  infos?.add(n)
  for (i in 0 until n.childCount) n.getChild(i)?.let { flatten(it, refs, infos, depth + 1) }
}

/** Package and label of every app with a launcher icon (the manifest's `<queries>` makes them visible). */
internal fun launcherApps(context: Context): List<Pair<String, String>> {
  val pm = context.packageManager
  return pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
    .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
    .distinctBy { it.first }
}
