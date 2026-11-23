package expo.modules.haloengine.android

import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Color
import android.net.Uri
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.haloengine.core.FlashDecision
import expo.modules.haloengine.core.LinkPulse
import expo.modules.haloengine.core.LinkShares
import expo.modules.haloengine.core.LinkSnapshot
import expo.modules.haloengine.core.LinkSurfaces
import expo.modules.haloengine.core.PulseKind
import expo.modules.haloengine.core.ProviderTrust
import expo.modules.haloengine.core.PulseState
import expo.modules.haloengine.core.QuietHours
import expo.modules.haloengine.core.RawRow
import expo.modules.haloengine.core.ReadShare
import expo.modules.haloengine.core.RereadGate
import expo.modules.haloengine.core.any
import expo.modules.haloengine.core.readsWaiting
import java.time.LocalTime
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object Links {
  private const val TIMEOUT_MS = 2_000L
  private val RED = Color.parseColor("#EF4444")
  private val AMBER = Color.parseColor("#F5A524")
  // ':' is not allowed in a package name, so these never share an app's flash slot.
  private val SHIELD_FLASH = FlashDecision("halo:shield", RED, "pulse", 2, 1_500L)
  private val WAITING_FLASH = FlashDecision("halo:waiting", AMBER, "pulse", 1, 2_000L)

  private val main = Handler(Looper.getMainLooper())
  private val reader = Executors.newSingleThreadExecutor { r -> Thread(r, "halo-links").apply { isDaemon = true } }
  private val queries = Executors.newCachedThreadPool { r -> Thread(r, "halo-link-query").apply { isDaemon = true } }
  private val gate = RereadGate()
  private var app: Context? = null
  private var pulse = PulseState()
  private var bubble: WaitingBubble? = null
  private val read = Runnable { readNow() }
  private val tick = Runnable { evaluate() }

  @Volatile var snapshot = LinkSnapshot()
    private set

  var onChange: (() -> Unit)? = null

  private fun clock() = SystemClock.elapsedRealtime()

  fun ping(ctx: Context) = main.post { if (wanted(ctx)) schedule(gate.onPing(clock())) }

  fun opened(ctx: Context) = main.post { if (wanted(ctx)) schedule(gate.onOpen(clock())) }

  fun ensureFresh(ctx: Context) = main.post { if (wanted(ctx)) schedule(gate.onStale(clock())) }

  fun settingsChanged(ctx: Context) = main.post {
    if (!wanted(ctx)) clear() else schedule(gate.onOpen(clock()))
    evaluate()
  }

  fun stop() = main.post {
    main.removeCallbacks(read)
    main.removeCallbacks(tick)
    bubble?.remove()
    bubble = null
  }

  private fun wanted(ctx: Context): Boolean {
    app = ctx.applicationContext
    return HaloService.current(ctx).links.any
  }

  private fun schedule(at: Long?) {
    at ?: return
    main.removeCallbacks(read)
    main.postDelayed(read, maxOf(0L, at - clock()))
  }

  private fun clear() {
    main.removeCallbacks(read)
    snapshot = LinkSnapshot()
    pulse = PulseState()
    onChange?.invoke()
  }

  private fun readNow() {
    val c = app ?: return
    gate.onRead(clock())
    val l = HaloService.current(c).links
    if (!l.any) return clear()
    reader.execute {
      val s = LinkSnapshot(
        shield = if (l.shieldPulse) LinkShares.shield(query(c, LinkShares.SHIELD)) else null,
        tunnelSeenAt = if (l.shieldPulse) LinkShares.lastSeenAt(query(c, LinkShares.TUNNEL_HEALTH), "open-tunnel") else null,
        newDevices = if (l.shieldPulse) LinkShares.newDevices(query(c, LinkShares.NEW_DEVICES)) else emptyList(),
        home = if (l.briefing && l.briefingPrivate) LinkShares.home(query(c, LinkShares.WHO_IS_HOME)) else emptyList(),
        suggestions = if (l.readsWaiting) LinkShares.suggestions(query(c, LinkShares.SUGGESTIONS)) else emptyList(),
        deputy = if (l.readsWaiting) LinkShares.deputyWaiting(query(c, LinkShares.DEPUTY_WAITING)) else emptyList(),
        briefing = if (l.briefing) LinkShares.briefing(query(c, LinkShares.BRIEFING)) else emptyList(),
      )
      main.post {
        snapshot = s
        ProbeLog.log(c, "links", "read shield=${s.shield != null} devices=${s.newDevices.size} waiting=${s.suggestions.size + s.deputy.size} briefing=${s.briefing.size}")
        onChange?.invoke()
        evaluate()
      }
    }
  }

  // A missing provider, a refusal (a debug build, the other app's switch off), a hang past the timeout or a broken cursor all mean "no data".
  private fun query(c: Context, share: ReadShare): List<RawRow> {
    if (!trusted(c, share.authority)) return emptyList()
    val signal = CancellationSignal()
    val job = queries.submit<List<RawRow>> {
      c.contentResolver.query(Uri.parse("content://${share.authority}/${share.path}"), null, null, null, null, signal)?.use { cur ->
        buildList { while (size < share.maxRows && cur.moveToNext()) add(row(cur)) }
      } ?: emptyList()
    }
    return try {
      job.get(TIMEOUT_MS, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {
      signal.cancel()
      job.cancel(true)
      emptyList()
    }
  }

  private fun trusted(c: Context, authority: String): Boolean = runCatching {
    val pm = c.packageManager
    val expected = ProviderTrust.expectedPackage(authority) ?: return false
    ProviderTrust.allowed(expected, pm.resolveContentProvider(authority, 0)?.packageName, pm.checkSignatures(c.packageName, expected) == PackageManager.SIGNATURE_MATCH)
  }.getOrDefault(false)

  private fun row(c: Cursor): RawRow = buildMap {
    for (i in 0 until c.columnCount) {
      when (c.getType(i)) {
        Cursor.FIELD_TYPE_NULL -> put(c.getColumnName(i), null)
        Cursor.FIELD_TYPE_INTEGER -> put(c.getColumnName(i), c.getLong(i))
        Cursor.FIELD_TYPE_FLOAT -> put(c.getColumnName(i), c.getDouble(i))
        Cursor.FIELD_TYPE_STRING -> put(c.getColumnName(i), c.getString(i))
      }
    }
  }

  private fun evaluate() {
    main.removeCallbacks(tick)
    val c = app ?: return
    val s = HaloService.current(c)
    val now = System.currentTimeMillis()
    val items = LinkSurfaces.waiting(snapshot, now)
    val shield = s.links.shieldPulse && LinkSurfaces.shieldAlert(snapshot, now)
    val waiting = s.links.waitingPulse && items.isNotEmpty()
    val minute = LocalTime.now().let { it.hour * 60 + it.minute }
    val dark = !c.getSystemService(PowerManager::class.java).isInteractive
    val step = LinkPulse.step(pulse, shield, waiting, dark || QuietHours.active(s.notify.quiet.on, s.notify.quiet.start, s.notify.quiet.end, minute), now)
    pulse = step.state
    when (step.show) {
      PulseKind.SHIELD -> HaloService.pulse(c, SHIELD_FLASH, RED)
      PulseKind.WAITING -> HaloService.pulse(c, WAITING_FLASH, AMBER)
      null -> Unit
    }
    step.nextAt?.let { main.postDelayed(tick, it - now) }
    showBubble(c, if (s.links.bubble) items.size else 0, LinkSurfaces.bubbleTarget(items))
  }

  private fun showBubble(c: Context, count: Int, target: String?) {
    if (count == 0 || target == null) {
      bubble?.remove()
      bubble = null
      return
    }
    val b = bubble ?: WaitingBubble(c, AMBER).also { bubble = it }
    b.show(count, target)
  }
}
