package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkSurfacesTest {
  private val now = 1_764_000_000_000L
  private val min = 60_000L
  private val hour = 60 * min

  private fun shield(untrusted: Boolean = true, since: Long = now - min, on: Boolean = true) = ShieldRow(on, untrusted, since)
  private fun device(ack: Boolean = false, at: Long = now - hour) = NewDeviceRow(at, "Phone", ack)

  @Test fun redPulseNeedsShieldsOnAndAFreshUntrustedNetworkOrANewDevice() {
    assertTrue(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield()), now))
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(on = false)), now))
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(untrusted = false)), now))
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(), now))
    assertTrue(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(untrusted = false), newDevices = listOf(device())), now))
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(untrusted = false), newDevices = listOf(device(ack = true))), now))
    assertFalse("Shields off: HomeNet's device alone does not pulse", LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(on = false), newDevices = listOf(device())), now))
    assertFalse("no shield row (Shields off or TunnelWall refused)", LinkSurfaces.shieldAlert(LinkSnapshot(newDevices = listOf(device())), now))
  }

  @Test fun aStaleUntrustedStateFailsQuietUnlessTunnelWallsHeartbeatIsRecent() {
    val old = shield(since = now - LinkSurfaces.SHIELD_FRESH_MS - 1)
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(shield = old), now))
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(shield = old, tunnelSeenAt = now - LinkSurfaces.SHIELD_FRESH_MS - 1), now))
    assertTrue(LinkSurfaces.shieldAlert(LinkSnapshot(shield = old, tunnelSeenAt = now - min), now))
    assertTrue(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(since = now - LinkSurfaces.SHIELD_FRESH_MS)), now))
  }

  @Test fun timesFromTheFutureDoNotCountAsFresh() {
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(since = now + LinkSurfaces.SKEW_MS + 1)), now))
    assertTrue(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(since = now + LinkSurfaces.SKEW_MS)), now))
    assertFalse(LinkSurfaces.shieldAlert(LinkSnapshot(shield = shield(untrusted = false), newDevices = listOf(device(at = now + hour))), now))
  }

  @Test fun anUnacknowledgedDeviceCountsForADayOnly() {
    val s = LinkSnapshot(shield = shield(untrusted = false), newDevices = listOf(device(at = now - LinkSurfaces.NEW_DEVICE_MS - 1)))
    assertFalse(LinkSurfaces.shieldAlert(s, now))
  }

  private fun suggestion(id: Long, title: String, state: String = "waiting", due: Long? = null, expires: Long = now + hour) =
    SuggestionRow(id, "reply", title, due, state, now - hour, expires)

  @Test fun waitingIsInflowsWaitingSuggestionsThenDeputysOkRequestsAndDrafts() {
    val s = LinkSnapshot(
      suggestions = listOf(
        suggestion(1, "Reply to Ali"),
        suggestion(2, "Bill due 25 Nov", due = now + 2 * hour),
        suggestion(3, "Meeting 11:00 tomorrow", due = now + hour),
        suggestion(4, "Done one", state = "done"),
        suggestion(5, "Gone", expires = now),
      ),
      deputy = listOf(
        DeputyWaitingRow(7, "Water the plants", now + min, "waiting_for_ok"),
        DeputyWaitingRow(8, "Expired OK", now - 1, "waiting_for_ok"),
        DeputyWaitingRow(9, "Draft from shared text", null, "draft"),
        DeputyWaitingRow(10, "Morning news", now + hour, "scheduled"),
        DeputyWaitingRow(11, "Unknown", null, "something_new"),
      ),
    )
    val items = LinkSurfaces.waiting(s, now)
    assertEquals(listOf("Meeting 11:00 tomorrow", "Bill due 25 Nov", "Reply to Ali", "Water the plants", "Draft from shared text"), items.map { it.title })
    assertEquals("com.haroon.inflow", LinkSurfaces.bubbleTarget(items))
    assertEquals("com.haroon.deputy", LinkSurfaces.bubbleTarget(items.filter { it.from == WaitingFrom.DEPUTY }))
    assertNull(LinkSurfaces.bubbleTarget(emptyList()))
  }

  // Hostile source text: amounts in words, unicode spaces, names, a direction override; none of it may reach a locked screen.
  private val hostile = listOf("Pay Ali rupees 4,200", "Rs\u00A04200 to Sara", "Sara\u2007Khan owes 900", "\u202Eevil", "Dr Ahmed at 14:00")
  private val briefing = listOf(
    BriefingLine(2, "steps", "3,200 steps yesterday", null, true),
    BriefingLine(1, "medicine", "Medicine at 14:00", now + hour, true),
    BriefingLine(3, "bill", "Bill due 25 Nov", null, false),
    BriefingLine(4, "todo", "2 to-dos today", null, false),
  ) + hostile.mapIndexed { i, t -> BriefingLine(10L + i, "bill", t, null, i % 2 == 0) }
  private val home = listOf(HomeRow("Sara", true, now - min), HomeRow("Ali", true, now - min), HomeRow("Zara", true, now - 3 * hour), HomeRow("Omar", false, now))
  private val full = LinkSnapshot(
    suggestions = listOf(suggestion(1, "Reply to Ali")) + hostile.mapIndexed { i, t -> suggestion(20L + i, t) },
    deputy = listOf(DeputyWaitingRow(7, "Pay the cook rupees 900", null, "draft")),
    briefing = briefing,
    home = home,
  )
  private val sourceText = (full.suggestions.map { it.title } + full.deputy.map { it.label } + full.briefing.map { it.text } + full.home.map { it.person })
  private val haloPhrase = Regex("^(1 thing is waiting|\\d+ things are waiting|Briefing ready)$")

  private fun all(b: AodLinks) = listOfNotNull(b.waiting, b.briefingHead) + b.waitingTitles + b.briefing

  @Test fun everySwitchStateLockedShowsOnlyHalosOwnPhrases() {
    for (waitingAod in listOf(false, true)) for (brief in listOf(false, true)) for (priv in listOf(false, true)) for (pulse in listOf(false, true)) {
      val links = SettingsLinks(waitingPulse = pulse, waitingAod = waitingAod, bubble = pulse, briefing = brief, briefingPrivate = priv)
      val b = LinkSurfaces.aod(full, links, locked = true, now = now)
      val shown = all(b)
      val case = "$links"
      assertTrue(case, b.waitingTitles.isEmpty() && b.briefing.isEmpty())
      for (t in shown) {
        assertTrue("$case: $t", haloPhrase.matches(t))
        for (src in sourceText) assertFalse("$case leaks $src", t.contains(src) || src.contains(t))
      }
      assertEquals(case, if (waitingAod) LinkSurfaces.waitingPhrase(7) else null, b.waiting)
      assertEquals(case, if (brief) LinkSurfaces.BRIEFING_READY else null, b.briefingHead)
    }
  }

  @Test fun lockedBriefingReadyCountsOnlyNonPrivateLines() {
    val onlyPrivate = LinkSnapshot(briefing = listOf(BriefingLine(1, "medicine", "Medicine at 14:00", null, true)))
    for (priv in listOf(false, true)) assertTrue(LinkSurfaces.aod(onlyPrivate, SettingsLinks(briefing = true, briefingPrivate = priv), locked = true, now = now).empty)
  }

  @Test fun unlockedShowsSourceLinesButPrivateOnesOnlyWithTheirSwitch() {
    for (waitingAod in listOf(false, true)) for (brief in listOf(false, true)) for (priv in listOf(false, true)) {
      val links = SettingsLinks(waitingAod = waitingAod, briefing = brief, briefingPrivate = priv)
      val b = LinkSurfaces.aod(full, links, locked = false, now = now)
      val case = "$links"
      if (!brief) assertTrue(case, b.briefing.isEmpty() && b.briefingHead == null)
      if (!waitingAod) assertTrue(case, b.waitingTitles.isEmpty() && b.waiting == null)
      val privateTexts = full.briefing.filter { it.personal }.map { it.text } + listOf("2 people at home")
      if (!priv) for (t in privateTexts) assertFalse("$case shows $t", t in b.briefing)
      assertTrue("no names of people at home, ever", all(b).none { it == "Sara" || it == "Ali" || "Sara," in it })
    }
    val open = LinkSurfaces.aod(full, SettingsLinks(briefing = true), locked = false, now = now)
    assertEquals(listOf("Bill due 25 Nov", "2 to-dos today", "Rs\u00A04200 to Sara", "\u202Eevil"), open.briefing)
    val mine = LinkSurfaces.aod(LinkSnapshot(briefing = briefing.take(4), home = home), SettingsLinks(briefing = true, briefingPrivate = true), locked = false, now = now)
    assertEquals(listOf("Medicine at 14:00", "3,200 steps yesterday", "Bill due 25 Nov", "2 to-dos today"), mine.briefing)
  }

  @Test fun alwaysOnRowsShowNothingWhileTheirSwitchesAreOff() {
    for (locked in listOf(true, false)) {
      assertTrue(LinkSurfaces.aod(full, SettingsLinks(), locked, now).empty)
      assertTrue(LinkSurfaces.aod(full, SettingsLinks(waitingPulse = true, bubble = true, briefingPrivate = true), locked, now).empty)
    }
  }

  @Test fun unlockedShowsTheCountAndAtMostThreeTitles() {
    val s = LinkSnapshot(suggestions = (1L..5L).map { suggestion(it, "Reply to person $it") })
    val block = LinkSurfaces.aod(s, SettingsLinks(waitingAod = true), locked = false, now = now)
    assertEquals("5 things are waiting", block.waiting)
    assertEquals(LinkSurfaces.AOD_TITLES, block.waitingTitles.size)
    assertEquals("1 thing is waiting", LinkSurfaces.waitingPhrase(1))
  }

  @Test fun unlockedBriefingIsCappedAndAPersonAtHomeNeedsAFreshSighting() {
    val on = SettingsLinks(briefing = true, briefingPrivate = true)
    assertEquals(listOf("1 person at home"), LinkSurfaces.aod(LinkSnapshot(home = listOf(HomeRow("Sara", true, now - min))), on, locked = false, now = now).briefing)
    assertTrue(LinkSurfaces.aod(LinkSnapshot(home = listOf(HomeRow("Sara", true, now - 3 * hour))), on, locked = false, now = now).briefing.isEmpty())
    assertTrue("people at home never show while locked", LinkSurfaces.aod(LinkSnapshot(home = home), on, locked = true, now = now).empty)
    val many = LinkSnapshot(briefing = (1L..9L).map { BriefingLine(it, "todo", "Line $it", null, false) })
    assertEquals(LinkSurfaces.AOD_BRIEFING, LinkSurfaces.aod(many, SettingsLinks(briefing = true), locked = false, now = now).briefing.size)
  }
}
