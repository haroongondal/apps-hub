package expo.modules.opentunnelnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KillSwitchTest {

  private fun run(enabled: Boolean, vararg events: KillSwitchEvent): Boolean =
    events.fold(false) { armed, event -> KillSwitch.next(armed, enabled, event) }

  @Test
  fun aFirstConnectThatNeverCameUpArmsNothing() {
    assertFalse(run(true, KillSwitchEvent.START, KillSwitchEvent.ENGINE_ENDED))
  }

  @Test
  fun aDropAfterConnectedStaysArmed() {
    assertTrue(run(true, KillSwitchEvent.START, KillSwitchEvent.CONNECTED, KillSwitchEvent.ENGINE_ENDED))
  }

  @Test
  fun aRelaySwitchKeepsTheBlockThroughTheNextStart() {
    assertTrue(run(true, KillSwitchEvent.START, KillSwitchEvent.CONNECTED, KillSwitchEvent.START))
  }

  @Test
  fun theSwitchOffDisarmsOnTheNextStart() {
    assertFalse(KillSwitch.next(true, false, KillSwitchEvent.START))
    assertFalse(KillSwitch.next(false, false, KillSwitchEvent.CONNECTED))
  }

  @Test
  fun theUserAndRevokesAlwaysDisarm() {
    for (event in listOf(KillSwitchEvent.USER_STOP, KillSwitchEvent.ENGINE_REVOKED, KillSwitchEvent.BLOCK_REVOKED)) {
      assertFalse(event.name, KillSwitch.next(true, true, event))
    }
  }

  @Test
  fun theBlockIsHeldOnlyWhileArmedAndNoEngineInterfaceIsUp() {
    val held = TunnelStatus.ALL.filter { KillSwitch.holdsBlock(true, it) }.toSet()
    assertEquals(
      setOf(TunnelStatus.DISCONNECTED, TunnelStatus.CONNECTING, TunnelStatus.DISCONNECTING, TunnelStatus.ERROR),
      held,
    )
    assertTrue(TunnelStatus.ALL.none { KillSwitch.holdsBlock(false, it) })
  }

  @Test
  fun aBlockHeldBeforeAnEngineStartedIsEstablishedAgain() {
    assertTrue(KillSwitch.reusesBlock(held = true, engineStartedSince = false))
    assertFalse(KillSwitch.reusesBlock(held = true, engineStartedSince = true))
    assertFalse(KillSwitch.reusesBlock(held = false, engineStartedSince = false))
    assertFalse(KillSwitch.reusesBlock(held = false, engineStartedSince = true))
  }

  @Test
  fun aBlockThatEstablishedReplacesTheOldOneAndIsPublished() {
    assertEquals(KillSwitch.BlockOutcome(held = true, closeOld = true, publish = true), KillSwitch.afterEstablish(hadBlock = true, established = true))
    assertEquals(KillSwitch.BlockOutcome(held = true, closeOld = true, publish = true), KillSwitch.afterEstablish(hadBlock = false, established = true))
  }

  // Known edge, pinned as it is today: the old fd is closed even though the new establish() failed (see KillSwitch.afterEstablish).
  @Test
  fun aFailedEstablishStillClosesTheOldBlockAndReportsNotBlocking() {
    assertEquals(KillSwitch.BlockOutcome(held = false, closeOld = true, publish = false), KillSwitch.afterEstablish(hadBlock = true, established = false))
  }

  @Test
  fun aFailedEstablishWithNoOldBlockPublishesNothing() {
    assertEquals(KillSwitch.BlockOutcome(held = false, closeOld = true, publish = null), KillSwitch.afterEstablish(hadBlock = false, established = false))
  }

  @Test
  fun aLiveBlockIsNeverRetriedSoTheEdgeNeedsAnEngineStartedSince() {
    // holdBlock calls afterEstablish only when reusesBlock is false.
    assertTrue(KillSwitch.reusesBlock(held = true, engineStartedSince = false))
    assertFalse(KillSwitch.reusesBlock(held = true, engineStartedSince = true))
  }
}
