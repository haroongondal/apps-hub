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

  private val briefing = listOf(
    BriefingLine(2, "steps", "3,200 steps yesterday", null, true),
    BriefingLine(1, "medicine", "Medicine at 14:00", now + hour, true),
    BriefingLine(3, "bill", "Bill due 25 Nov", null, false),
    BriefingLine(4, "todo", "2 to-dos today", null, false),
    BriefingLine(5, "bill", "Electricity PKR 4,200 due", null, false),
  )
  private val home = listOf(HomeRow("Sara", true, now - min), HomeRow("Ali", true, now - min), HomeRow("Zara", true, now - 3 * hour), HomeRow("Omar", false, now))

  @Test fun alwaysOnRowsShowNothingWhileTheirSwitchesAreOff() {
    val s = LinkSnapshot(suggestions = listOf(suggestion(1, "Reply to Ali")), briefing = briefing, home = home)
    assertTrue(LinkSurfaces.aod(s, SettingsLinks(), now).empty)
    assertTrue(LinkSurfaces.aod(s, SettingsLinks(waitingPulse = true, bubble = true, briefingPrivate = true), now).empty)
  }

  @Test fun briefingShowsOnlyNonPrivateLinesUnlessThePrivateSwitchIsOn() {
    val s = LinkSnapshot(briefing = briefing, home = home)
    val open = LinkSurfaces.aod(s, SettingsLinks(briefing = true), now)
    assertEquals(listOf("Bill due 25 Nov", "2 to-dos today"), open.briefing)
    val all = LinkSurfaces.aod(s, SettingsLinks(briefing = true, briefingPrivate = true), now)
    assertEquals(listOf("Medicine at 14:00", "Bill due 25 Nov", "2 to-dos today", "2 people at home"), all.briefing)
    assertTrue("no names of people at home, ever", all.briefing.none { "Sara" in it || "Ali" in it })
  }

  @Test fun theLockScreenNeverShowsAmountsOrLongNumbers() {
    for (t in listOf("Electricity PKR 4,200 due", "Rs. 500 to Ali", "Paid $20", "4200 PKR", "Balance 12,345", "Card 4111111111111111", "€5 fee")) {
      assertNull(t, LinkSurfaces.lockSafe(t))
    }
    for (t in listOf("Bill due 25 Nov", "Meeting 11:00 tomorrow", "Reply to Ali", "2 to-dos today", "Year 2026")) assertEquals(t, LinkSurfaces.lockSafe(t))
    val s = LinkSnapshot(suggestions = listOf(suggestion(1, "Pay PKR 4,200"), suggestion(2, "Reply to Ali")))
    val block = LinkSurfaces.aod(s, SettingsLinks(waitingAod = true), now)
    assertEquals("the count still includes the hidden one", 2, block.waitingCount)
    assertEquals(listOf("Reply to Ali"), block.waitingTitles)
  }

  @Test fun theWaitingRowShowsTheCountAndAtMostThreeTitles() {
    val s = LinkSnapshot(suggestions = (1L..5L).map { suggestion(it, "Reply to person $it") })
    val block = LinkSurfaces.aod(s, SettingsLinks(waitingAod = true), now)
    assertEquals(5, block.waitingCount)
    assertEquals(LinkSurfaces.AOD_TITLES, block.waitingTitles.size)
  }

  @Test fun briefingIsCappedAndAPersonAtHomeNeedsAFreshSighting() {
    val one = LinkSurfaces.aod(LinkSnapshot(home = listOf(HomeRow("Sara", true, now - min))), SettingsLinks(briefing = true, briefingPrivate = true), now)
    assertEquals(listOf("1 person at home"), one.briefing)
    val stale = LinkSurfaces.aod(LinkSnapshot(home = listOf(HomeRow("Sara", true, now - 3 * hour))), SettingsLinks(briefing = true, briefingPrivate = true), now)
    assertTrue(stale.briefing.isEmpty())
    val many = LinkSnapshot(briefing = (1L..9L).map { BriefingLine(it, "todo", "Line $it", null, false) })
    assertEquals(LinkSurfaces.AOD_BRIEFING, LinkSurfaces.aod(many, SettingsLinks(briefing = true), now).briefing.size)
  }
}
