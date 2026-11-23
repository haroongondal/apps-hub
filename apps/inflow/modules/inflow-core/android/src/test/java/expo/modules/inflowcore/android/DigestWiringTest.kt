package expo.modules.inflowcore.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The glue needs a device, so this pins the source text of the 08:00 and 20:00 summary and of the changed ping to Halo (the pure parts have their own tests).
class DigestWiringTest {
  private val src = File("src/main/java/expo/modules/inflowcore")   // Gradle runs module unit tests from the module's android/ folder

  private fun text(name: String) = File(src, name).also { assertTrue("$name not found from ${File(".").absoluteFile}", it.isFile) }.readLines().filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") || it.trimStart().startsWith("/*") }.joinToString("\n")

  // ---- the notification: secret when a line is personal, else private with a public version that holds the count only

  @Test fun theNotificationIsSecretWhenPersonalElsePrivateWithAPublicVersionThatHoldsTheCountOnly() {
    val t = text("android/DigestNotifier.kt")
    assertTrue(t.contains("NotificationChannel(CHANNEL, \"Daily summary\", NotificationManager.IMPORTANCE_LOW)"))
    assertTrue(t.contains("val lock = Digest.lockScreenText(c)"))
    assertTrue(t.contains(".setVisibility(if (public == null) NotificationCompat.VISIBILITY_SECRET else NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)"))
    assertEquals(1, Regex("setVisibility").findAll(t).count())
    assertTrue("the notification must not be public", !t.contains("VISIBILITY_PUBLIC"))
    val public = t.lines().single { it.contains("val public = ") }
    assertTrue(public, public.contains("val public = lock?.let { ") && public.contains(".setContentTitle(c.title).setContentText(it).build() }"))
    assertTrue("the count is read only through the lock-screen decision", !t.contains("c.publicText") && !t.contains("c.personal"))
    // Neither the private text nor anything else of the content reaches the public builder, and the lines are named only after it.
    assertTrue(public, !public.contains("lines") && !public.contains("setStyle") && !public.contains("first()"))
    assertTrue(t.indexOf("c.lines") > t.indexOf("val public = "))
    assertEquals(1, Regex("setPublicVersion").findAll(t).count())
    assertEquals(1, Regex("\\.notify\\(").findAll(t).count())
    assertTrue("one id per kind, replacing the older", t.contains("manager.notify(TAG, c.kind.ordinal + 1, b.build())"))
    assertTrue("no notifications permission: nothing is posted", t.indexOf("if (!ReportNotifier.allowed(ctx)) return") in 0 until t.indexOf("createNotificationChannel"))
    // The tap opens the app's own launcher screen, which sits behind the fingerprint lock.
    assertTrue(t.contains("getLaunchIntentForPackage(ctx.packageName)"))
    assertTrue(!Regex("\\bIntent\\(").containsMatchIn(t) && !t.contains("addAction"))
  }

  // ---- the alarm

  @Test fun theAlarmIsInexactCancelledWhenOffAndArmedAgainInFinally() {
    val t = text("android/DigestAlarm.kt")
    assertTrue(t.contains("if (on) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Digest.nextAt(System.currentTimeMillis(), ZoneId.systemDefault()), pi) else alarms.cancel(pi)"))
    assertTrue(!t.contains("setExact") && !t.contains("setAlarmClock") && !t.contains("SCHEDULE_EXACT"))
    assertTrue("an alarm that is not exported to anyone: explicit class", t.contains("Intent(ctx, DigestAlarmReceiver::class.java)"))
    val fire = t.substringAfter("internal fun fire").substringBefore("class DigestAlarmReceiver")
    assertTrue(fire.substringAfter("finally {").contains("arm(ctx)"))
    assertTrue("a switch that is off posts nothing", fire.indexOf("Digest.META") in 0 until fire.indexOf("DigestNotifier.post"))
    for (r in listOf("class DigestAlarmReceiver", "class DigestBootReceiver")) {
      val body = t.substringAfter(r)
      assertTrue(r, body.substringBefore("override fun onReceive").length < 120 && body.contains("goAsync()"))
    }
    assertTrue("readers never run on the main thread", t.contains("DigestAlarm.executor.execute"))
    assertTrue(t.contains("if (intent.action != Intent.ACTION_BOOT_COMPLETED) return"))
    assertTrue("the boot receiver arms the summary only", text("android/DigestAlarm.kt").substringAfter("class DigestBootReceiver").let { it.contains("DigestAlarm.arm(app)") && !it.contains("MedicineReminders") })
  }

  @Test fun theSwitchTheHeartbeatAndTheModuleArmTheAlarm() {
    assertTrue(text("android/StoreHolder.kt").substringAfter("fun heartbeat").substringBefore("fun storeError").contains("DigestAlarm.rearm(app)"))
    val module = text("InflowCoreModule.kt")
    val setter = module.substringAfter("Function(\"setDigest\")").substringBefore("Function(")
    assertTrue(setter, setter.contains("Digest.META") && setter.contains("DigestAlarm.rearm(context)"))
    assertTrue(setter.indexOf("setMeta") < setter.indexOf("rearm"))
    assertTrue("off by default: the getter reads the meta only", module.substringAfter("Function(\"digest\")").substringBefore("Function(").contains("Briefing.on(store().meta(Digest.META))"))
  }

  // ---- the changed ping

  @Test fun theBroadcastIsExplicitDataFreeAndAsksTheTargetFirst() {
    val t = text("android/HaloPing.kt")
    val trusted = t.indexOf("AppLinkTarget.trustedReceiver(app, Intent(action).setPackage(pkg))")
    val send = t.indexOf("app.sendBroadcast(Intent(action).setPackage(pkg), AppLinkTarget.LINK_PERMISSION)")
    assertTrue(trusted >= 0 && send >= 0)
    assertEquals(1, Regex("sendBroadcast\\(").findAll(t).count())
    assertTrue("no extras, data or component", !Regex("putExtra|putExtras|setData|setComponent|setClass|setAction|setType").containsMatchIn(t))
    assertTrue("the sender asks before it sends", text("core/ChangedPing.kt").let { it.indexOf("if (!transport.trusted(ACTION, TARGET)) return false") in 0 until it.indexOf("transport.send(ACTION, TARGET)") })
    assertTrue("the transport lives in one object", t.indexOf("PingTransport") > 0 && t.contains("ChangedSender.send(transport(app))"))
  }

  @Test fun onlyTheChangedSenderNamesTheActionAndOnlyHaloPingBroadcastsIt() {
    val users = src.walk().filter { it.isFile && it.extension == "kt" && "/applink/" !in it.path }.filter { it.readText().contains("com.haroon.autopilot.CHANGED") }.map { it.name }.toList()
    assertEquals(listOf("ChangedPing.kt"), users)
    val callers = src.walk().filter { it.isFile && it.extension == "kt" }.filter { it.readText().contains("ChangedSender.send(") }.map { it.name }.toList().sorted()
    assertEquals(listOf("HaloPing.kt"), callers)
  }

  @Test fun theBriefingAndTheWaitingSuggestionsBothGoThroughTheOneLimiter() {
    assertTrue(text("android/BriefingRefresh.kt").contains("{ HaloPing.changed(app) },"))
    assertTrue(text("android/BriefingRefresh.kt").substringAfter("fun settingChanged").substringBefore("private fun create").contains("HaloPing.changed(context)"))
    assertTrue(text("android/StoreHolder.kt").contains("WaitingWatch { HaloPing.changed(app) }"))
    val store = text("android/SqlSuggestionStore.kt")
    // Every insert and every move out of the waiting state ends in noteWaiting, which compares the set of waiting ids by value.
    assertEquals(4, Regex("noteWaiting\\(\\) \\}").findAll(store).count())
    assertTrue(store.contains("SELECT id FROM suggestions WHERE state = 'WAITING'"))
    for (fn in listOf("override fun add", "override fun setState", "override fun expire", "override fun closeReplies")) {
      val body = store.substringAfter(fn).substringBefore("\n\n")
      assertTrue(fn, body.contains("noteWaiting()"))
    }
    assertEquals(1, Regex("limiter\\.request").findAll(text("android/HaloPing.kt")).count())
    assertTrue("no other caller pings around the limiter", src.walk().filter { it.isFile && it.extension == "kt" && it.name != "HaloPing.kt" }.none { it.readText().contains("ChangedSender") && it.name != "ChangedPing.kt" })
  }
}
