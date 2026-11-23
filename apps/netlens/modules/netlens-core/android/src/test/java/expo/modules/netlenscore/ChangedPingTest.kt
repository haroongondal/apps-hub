package expo.modules.netlenscore

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChangedPingTest {
  private val on = HomeSettings(whoIsHome = true, newDevices = true, share = true)
  private val t = 1_764_000_000_000L

  private fun person(label: String, present: Boolean) = PersonWatch(label, emptyList(), Presence.State(present, 0, t))

  @Test fun aNewDevicePingsWheneverSharingAndTheCheckAreOn() {
    assertTrue(ChangedPing.due(on, newDevice = true, presenceChanged = false, lastPingAt = t, now = t))
    assertFalse(ChangedPing.due(on.copy(share = false), newDevice = true, presenceChanged = false, lastPingAt = 0, now = t))
    assertFalse(ChangedPing.due(on.copy(newDevices = false), newDevice = true, presenceChanged = false, lastPingAt = 0, now = t))
  }

  @Test fun aPresenceChangePingsAtMostOnceAMinute() {
    assertTrue(ChangedPing.due(on, false, true, lastPingAt = 0, now = t))
    assertFalse(ChangedPing.due(on, false, true, lastPingAt = t, now = t + 59_999))
    assertTrue(ChangedPing.due(on, false, true, lastPingAt = t, now = t + 60_000))
    assertTrue("a clock set back does not stall it", ChangedPing.due(on, false, true, lastPingAt = t, now = t - 1))
  }

  @Test fun presenceNeedsSharingAndWhoIsHomeOnAndAChange() {
    assertFalse(ChangedPing.due(on.copy(share = false), false, true, 0, t))
    assertFalse(ChangedPing.due(on.copy(whoIsHome = false), false, true, 0, t))
    assertFalse(ChangedPing.due(on, false, false, 0, t))
  }

  @Test fun presenceChangedMeansSomeoneArrivedOrLeft() {
    val before = listOf(person("Sara", true), person("Ali", false))
    assertFalse(ChangedPing.presenceChanged(before, before))
    assertFalse("only the last-seen time moved", ChangedPing.presenceChanged(before, before.map { it.copy(state = it.state.copy(lastSeenAt = t + 1)) }))
    assertFalse("case of the tag", ChangedPing.presenceChanged(before, listOf(person("sara", true), person("Ali", false))))
    assertTrue("Ali arrived", ChangedPing.presenceChanged(before, listOf(person("Sara", true), person("Ali", true))))
    assertTrue("Sara left", ChangedPing.presenceChanged(before, listOf(person("Sara", false), person("Ali", false))))
  }

  @Test fun thePingIsTheContractPing() {
    assertTrue(ChangedPing.ACTION == "com.haroon.autopilot.CHANGED" && ChangedPing.TARGET_PACKAGE == "com.haroon.halo")
  }
}
