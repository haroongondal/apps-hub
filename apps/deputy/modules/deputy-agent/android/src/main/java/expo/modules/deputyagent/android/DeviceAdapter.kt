package expo.modules.deputyagent.android

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.AlarmManager
import android.app.usage.StorageStatsManager
import android.accessibilityservice.GestureDescription
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.os.storage.StorageManager
import android.provider.AlarmClock
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.Settings
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
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
import expo.modules.deputyagent.core.TrustLevel
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
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
    launcherApps(context).filter { (pkg, label) -> DeviceRules.appMatches(name, pkg, label) }

  override fun resolveLink(url: String): String? = handler(linkIntent(url))

  override fun resolveClock(): String? = handler(Intent(AlarmClock.ACTION_SET_ALARM))

  override fun resolveContacts(): String? = handler(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CONTACTS))

  private fun handler(intent: Intent) = context.packageManager
    .resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.takeIf { it != "android" }

  override fun info(): String {
    val gb = { bytes: Long -> "%.1f GB".format(Locale.ENGLISH, bytes / 1e9) }
    val stats = context.getSystemService(StorageStatsManager::class.java)
    val storage = runCatching { "${gb(stats.getFreeBytes(StorageManager.UUID_DEFAULT))} free of ${gb(stats.getTotalBytes(StorageManager.UUID_DEFAULT))}" }.getOrDefault("unknown")
    val battery = context.getSystemService(BatteryManager::class.java)
    val zone = ZoneId.systemDefault()
    val time = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy, HH:mm", Locale.ENGLISH).withZone(zone)
    val next = context.getSystemService(AlarmManager::class.java).nextAlarmClock
    val setter = next?.showIntent?.creatorPackage
    val alarm = DeviceRules.nextAlarm(
      next?.let { time.format(Instant.ofEpochMilli(it.triggerTime)) }, setter?.let(::label), setter != null && OwnerStore.trust(context).level(setter) == TrustLevel.BLOCKED,
    )
    val net = context.getSystemService(ConnectivityManager::class.java).let { it.getNetworkCapabilities(it.activeNetwork) }
    return listOf(
      "Android ${Build.VERSION.RELEASE} (build ${Build.DISPLAY}), ${Build.MANUFACTURER} ${Build.MODEL}",
      "Battery ${battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)}%${if (battery.isCharging) ", charging" else ""}",
      "Storage $storage",
      "Next alarm $alarm",
      "Network " + when {
        net == null -> "offline"
        net.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
        net.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile data"
        else -> "connected"
      },
      "Time ${time.format(Instant.now())} ($zone)",
    ).joinToString("\n")
  }

  override fun contacts(name: String): String {
    if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
      return "Deputy may not read contacts. The owner can allow it in Deputy's Settings, under Setup."
    }
    // Numbers go out in international form, which open_chat needs; a local "0300…" gets the SIM's country code.
    val country = context.getSystemService(TelephonyManager::class.java)?.let { it.simCountryIso.ifEmpty { it.networkCountryIso } }
      .orEmpty().ifEmpty { Locale.getDefault().country }.uppercase()
    val rows = context.contentResolver.query(
      Phone.CONTENT_URI, arrayOf(Phone.DISPLAY_NAME, Phone.NUMBER), "${Phone.DISPLAY_NAME} LIKE ?", arrayOf("%$name%"), Phone.DISPLAY_NAME,
    )?.use { c -> buildList { while (size < 40 && c.moveToNext()) add(c.getString(0).orEmpty() to c.getString(1).orEmpty()) } }.orEmpty()
    val found = rows.map { (n, num) -> "$n: ${PhoneNumberUtils.formatNumberToE164(num, country) ?: num}" }.distinct().take(8)
    return if (found.isEmpty()) "No contact matches $name." else found.joinToString("\n")
  }

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
      is Action.OpenSettings -> start(s, Intent(SETTINGS_PAGES.getValue(action.page)), "Opened ${action.page} settings.")
      is Action.SetAlarm -> start(
        s,
        Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, action.hour).putExtra(AlarmClock.EXTRA_MINUTES, action.minute)
          .putExtra(AlarmClock.EXTRA_SKIP_UI, true).putExtra(AlarmClock.EXTRA_MESSAGE, action.label),
        "Asked the clock app to set the alarm.",
      )
      is Action.SetTimer -> start(
        s,
        Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, action.seconds)
          .putExtra(AlarmClock.EXTRA_SKIP_UI, true).putExtra(AlarmClock.EXTRA_MESSAGE, action.label),
        "Asked the clock app to start the timer.",
      )
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
    // Replaces rather than appends: WhatsApp reports its empty box as the text "Message" (phone, 2026-10-30).
    val before = shownText(n)
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, a.text) }
    n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    delay(300)
    n.refresh()
    if (a.text.isNotEmpty() && shownText(n) == before && before != a.text) return CANT_TYPE
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

/** Keyed by `Tools.PAGES`. */
private val SETTINGS_PAGES = mapOf(
  "wifi" to Settings.ACTION_WIFI_SETTINGS, "bluetooth" to Settings.ACTION_BLUETOOTH_SETTINGS,
  "internet" to Settings.Panel.ACTION_INTERNET_CONNECTIVITY, "airplane" to Settings.ACTION_AIRPLANE_MODE_SETTINGS,
  "display" to Settings.ACTION_DISPLAY_SETTINGS, "sound" to Settings.ACTION_SOUND_SETTINGS, "volume" to Settings.Panel.ACTION_VOLUME,
  "battery" to Intent.ACTION_POWER_USAGE_SUMMARY, "storage" to Settings.ACTION_INTERNAL_STORAGE_SETTINGS,
  "apps" to Settings.ACTION_APPLICATION_SETTINGS, "location" to Settings.ACTION_LOCATION_SOURCE_SETTINGS,
  "date" to Settings.ACTION_DATE_SETTINGS, "about" to Settings.ACTION_DEVICE_INFO_SETTINGS, "nfc" to Settings.ACTION_NFC_SETTINGS,
)

internal fun linkIntent(url: String): Intent {
  val uri = Uri.parse(url)
  return when (uri.scheme?.lowercase()) {
    "tel" -> Intent(Intent.ACTION_DIAL, uri)
    // The body goes in the extra every messaging app reads; left in the address, some apps take it as part of the number.
    "sms", "smsto" -> Intent(Intent.ACTION_SENDTO, Uri.parse(url.substringBefore('?')))
      .apply { url.substringAfter("?body=", "").takeIf { it.isNotEmpty() }?.let { putExtra("sms_body", Uri.decode(it)) } }
    "mailto" -> Intent(Intent.ACTION_SENDTO, uri)
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
    checked = if (n.isCheckable) n.isChecked else null,
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
