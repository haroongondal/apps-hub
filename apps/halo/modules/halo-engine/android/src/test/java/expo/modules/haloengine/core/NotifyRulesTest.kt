package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotifyRulesTest {
  private val own = "com.haroon.halo"
  private val noon = 12 * 60
  private fun note(
    key: String = "k1", pkg: String = "com.chat", ongoing: Boolean = false, importance: Int = 3,
    summary: Boolean = false, category: String? = null, at: Long = 0, once: Boolean = false,
  ) = PostedNote(key, pkg, ongoing, importance, summary, category, at, once)

  @Test
  fun skipsOwnOngoingSilentSummary() {
    val r = NotifyRules(own)
    val s = SettingsNotify()
    assertNull(r.onPosted(note(pkg = own), s, noon, 0))
    assertNull(r.onPosted(note(ongoing = true), s, noon, 0))
    assertNull(r.onPosted(note(importance = 2), s, noon, 0))
    assertNull(r.onPosted(note(importance = 0), s, noon, 0))
    assertNull(r.onPosted(note(summary = true), s, noon, 0))
    assertEquals(0, r.trackedCount())
    assertNotNull(r.onPosted(note(importance = 3), s, noon, 0))
    assertNotNull(r.onPosted(note(key = "k2", importance = 5), s, noon, 0))
  }

  @Test
  fun appOffAndDefaultOff() {
    val r = NotifyRules(own)
    val apps = mapOf("com.off" to AppNotify(on = false), "com.on" to AppNotify(on = true))
    val on = SettingsNotify(apps = apps, defaultOn = true)
    assertNull(r.onPosted(note(pkg = "com.off"), on, noon, 0))
    assertNotNull(r.onPosted(note(key = "a", pkg = "com.on"), on, noon, 0))
    val off = SettingsNotify(apps = apps, defaultOn = false)
    assertNull(r.onPosted(note(key = "b", pkg = "com.unlisted"), off, noon, 0))
    assertNotNull(r.onPosted(note(key = "c", pkg = "com.on"), off, noon, 0))
    assertNull(r.onPosted(note(key = "d", pkg = "com.on"), SettingsNotify(enabled = false), noon, 0))
  }

  @Test
  fun unknownAppUsesDefaults() {
    val r = NotifyRules(own)
    // The list names an app that is gone and does not name the one that just appeared.
    val s = SettingsNotify(apps = mapOf("com.uninstalled" to AppNotify(on = false, colour = "#112233")), style = "sweep", repeat = 3, durationMs = 2000)
    val d = r.onPosted(note(pkg = "com.brand.new"), s, noon, 0)!!
    assertEquals(FlashDecision("com.brand.new", null, "sweep", 3, 2000L), d)
  }

  @Test
  fun colourComesFromTheEntry() {
    val r = NotifyRules(own)
    val s = SettingsNotify(apps = mapOf("com.a" to AppNotify(true, "#25D366"), "com.b" to AppNotify(true, null), "com.c" to AppNotify(true, "bogus")))
    assertEquals(0xFF25D366.toInt(), r.onPosted(note(key = "a", pkg = "com.a"), s, noon, 0)!!.colour)
    assertNull(r.onPosted(note(key = "b", pkg = "com.b"), s, noon, 0)!!.colour)
    assertNull(r.onPosted(note(key = "c", pkg = "com.c"), s, noon, 0)!!.colour)
  }

  @Test
  fun quietSuppresses() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = 1, quiet = SettingsQuiet(on = true, start = "22:00", end = "07:00"))
    assertNull(r.onPosted(note(), s, 23 * 60, 0))
    assertEquals(0, r.trackedCount())
    assertNotNull(r.onPosted(note(key = "k2"), s, noon, 0))
    // A reminder that falls due inside quiet hours stays silent and is not retried every tick.
    assertTrue(r.dueReminders(s, 23 * 60, 60_000).isEmpty())
    assertEquals(120_000L, r.nextReminderAtMs(s))
  }

  @Test
  fun burstCoalesces() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = 5)
    for (i in 0 until 50) assertNotNull(r.onPosted(note(at = i * 1000L), s, noon, i * 1000L))
    assertEquals(1, r.trackedCount())
    // The last post restarted the reminder clock.
    assertEquals(49_000L + 5 * 60_000L, r.nextReminderAtMs(s))
  }

  @Test
  fun trackingIsBounded() {
    val r = NotifyRules(own)
    val s = SettingsNotify()
    for (i in 0 until 5000) r.onPosted(note(key = "k$i"), s, noon, i.toLong())
    val n = r.trackedCount()
    assertTrue(n in 1..200)
    // The newest survives, the oldest was dropped.
    r.onRemoved("k4999")
    assertEquals(n - 1, r.trackedCount())
    r.onRemoved("k0")
    assertEquals(n - 1, r.trackedCount())
  }

  @Test
  fun reminderEveryPeriodUntilUnlock() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = 2, style = "sweep")
    r.onPosted(note(at = 0), s, noon, 0)
    assertEquals(120_000L, r.nextReminderAtMs(s))
    assertTrue(r.dueReminders(s, noon, 119_999).isEmpty())
    val first = r.dueReminders(s, noon, 120_000)
    assertEquals(listOf("com.chat"), first.map { it.pkg })
    assertEquals("sweep", first[0].style)
    // Once per period, however often it is asked.
    assertTrue(r.dueReminders(s, noon, 120_001).isEmpty())
    assertEquals(240_000L, r.nextReminderAtMs(s))
    assertEquals(1, r.dueReminders(s, noon, 240_000).size)
    assertEquals(1, r.dueReminders(s, noon, 360_000).size)
    r.onUnlocked(400_000)
    assertEquals(0, r.trackedCount())
    assertTrue(r.dueReminders(s, noon, 10_000_000).isEmpty())
    assertNull(r.nextReminderAtMs(s))
  }

  @Test
  fun removedCancelsReminder() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = 1)
    r.onPosted(note(key = "a", at = 0), s, noon, 0)
    r.onPosted(note(key = "b", pkg = "com.mail", at = 0), s, noon, 0)
    r.onRemoved("a")
    r.onRemoved("never-posted")
    assertEquals(listOf("com.mail"), r.dueReminders(s, noon, 60_000).map { it.pkg })
    r.onRemoved("b")
    assertTrue(r.dueReminders(s, noon, 120_000).isEmpty())
    assertNull(r.nextReminderAtMs(s))
  }

  @Test
  fun noRemindersWhenNull() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = null)
    r.onPosted(note(at = 0), s, noon, 0)
    assertTrue(r.dueReminders(s, noon, 10_000_000).isEmpty())
    assertNull(r.nextReminderAtMs(s))
  }

  @Test
  fun reminderSkipsAnAppSwitchedOffSincePosting() {
    val r = NotifyRules(own)
    r.onPosted(note(at = 0), SettingsNotify(reminderMin = 1), noon, 0)
    val off = SettingsNotify(reminderMin = 1, apps = mapOf("com.chat" to AppNotify(on = false)))
    assertTrue(r.dueReminders(off, noon, 60_000).isEmpty())
  }

  @Test
  fun onlyAlertOnceUpdateIsSilent() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = 1)
    assertNotNull(r.onPosted(note(at = 0, once = true), s, noon, 0))
    // An update that asked not to alert again neither flashes nor restarts the reminder clock.
    assertNull(r.onPosted(note(at = 30_000, once = true), s, noon, 30_000))
    assertEquals(60_000L, r.nextReminderAtMs(s))
    // An update without the flag alerts, as the system does.
    assertNotNull(r.onPosted(note(at = 40_000), s, noon, 40_000))
  }

  @Test
  fun onlyAlertOnceAfterUnlockDoesNotRearm() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = 1)
    r.onPosted(note(at = 0, once = true), s, noon, 0)
    r.onUnlocked(10_000)
    assertNull(r.onPosted(note(at = 20_000, once = true), s, noon, 20_000))
    assertEquals(0, r.trackedCount())
    assertNull(r.nextReminderAtMs(s))
  }

  @Test
  fun repostSamePostTimeIsSilent() {
    val r = NotifyRules(own)
    val s = SettingsNotify(reminderMin = 1)
    assertNotNull(r.onPosted(note(at = 5_000), s, noon, 5_000))
    r.onUnlocked(6_000)
    // The system re-posts an auto-grouped notification with its old postTime: no flash, no tracking.
    assertNull(r.onPosted(note(at = 5_000), s, noon, 7_000))
    assertEquals(0, r.trackedCount())
    // Removed, then posted again (a new postTime): it alerts.
    r.onRemoved("k1")
    assertNotNull(r.onPosted(note(at = 8_000), s, noon, 8_000))
  }

  @Test
  fun restoreTracksWhatArrivedSinceTheLastUnlock() {
    val r = NotifyRules(own)
    val s = SettingsNotify(
      reminderMin = 1,
      apps = mapOf("com.off" to AppNotify(on = false)),
      quiet = SettingsQuiet(on = true, start = "22:00", end = "07:00"),
    )
    val quietAt = 9_000L
    val notes = listOf(
      note(key = "late", at = 7_000),
      note(key = "seen", at = 1_000),
      note(key = "ongoing", ongoing = true, at = 7_000),
      note(key = "own", pkg = own, at = 7_000),
      note(key = "off", pkg = "com.off", at = 7_000),
      note(key = "quiet", at = quietAt),
      note(key = "early", pkg = "com.mail", at = 6_000),
    )
    r.restore(notes, lastUnlockMs = 5_000, s = s) { if (it == quietAt) 23 * 60 else noon }
    assertEquals(2, r.trackedCount())
    // Tracked from postTime, so the eldest is due first.
    assertEquals(66_000L, r.nextReminderAtMs(s))
    assertEquals(listOf("com.mail", "com.chat"), r.dueReminders(s, noon, 67_000).map { it.pkg })
    // What was already showing stays silent when the system re-posts it.
    assertNull(r.onPosted(note(key = "seen", at = 1_000), s, noon, 70_000))
    assertNull(r.onPosted(note(key = "late", at = 7_000, once = true), s, noon, 70_000))
  }

  @Test
  fun colourFallsBackFromEntryToBrandToIcon() {
    val r = NotifyRules(own)
    val s = SettingsNotify(apps = mapOf("com.whatsapp" to AppNotify(true, "#112233")))
    assertEquals(0xFF112233.toInt(), r.onPosted(note(key = "a", pkg = "com.whatsapp"), s, noon, 0)!!.colour)
    assertEquals(0xFF25D366.toInt(), r.onPosted(note(key = "b", pkg = "com.whatsapp.w4b"), s, noon, 0)!!.colour)
    assertEquals(0xFFFF3D9A.toInt(), r.onPosted(note(key = "c", pkg = "com.instagram.android"), s, noon, 0)!!.colour)
    assertNull(r.onPosted(note(key = "d", pkg = "com.chat"), s, noon, 0)!!.colour)
  }

  @Test
  fun appStyleOverridesTheGlobalStyle() {
    val r = NotifyRules(own)
    val s = SettingsNotify(style = "pulse", apps = mapOf("com.a" to AppNotify(style = "sweep"), "com.b" to AppNotify(style = null)))
    assertEquals("sweep", r.onPosted(note(key = "a", pkg = "com.a"), s, noon, 0)!!.style)
    assertEquals("pulse", r.onPosted(note(key = "b", pkg = "com.b"), s, noon, 0)!!.style)
    assertEquals("pulse", r.onPosted(note(key = "c", pkg = "com.unlisted"), s, noon, 0)!!.style)
    // Reminders use the same per-app style.
    val rem = SettingsNotify(style = "pulse", reminderMin = 1, apps = s.apps)
    assertEquals(listOf("sweep", "pulse", "pulse"), r.dueReminders(rem, noon, 60_000).map { it.style })
  }
}
