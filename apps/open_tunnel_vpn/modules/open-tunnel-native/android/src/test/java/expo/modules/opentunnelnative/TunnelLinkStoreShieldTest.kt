package expo.modules.opentunnelnative

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** The shield row exactly as TunnelLinkProvider serves it: TunnelLinkStore.shield(prefs) + networkWatched through ShieldLink.shieldRows. */
class TunnelLinkStoreShieldTest {
  private val prefs = FakePrefs()

  @Before fun noWatch() = TunnelLinkStore.watchStopped()

  private fun served(): List<Array<Any?>> = ShieldLink.shieldRows(TunnelLinkStore.shield(prefs), TunnelLinkStore.networkWatched)

  private fun untrustedColumn(): Any? = served().single()[1]

  @Test fun aTrustedRowSavedByAnEarlierRunIsUntrustedUntilTheFirstShieldsOnPublishOfTheNewWatch() {
    TunnelLinkStore.watchStarted()
    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 10L)
    TunnelLinkStore.watchStopped()

    TunnelLinkStore.watchStarted()
    assertEquals(1, untrustedColumn())

    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 20L)
    assertEquals(0, untrustedColumn())
    assertEquals(10L, served().single()[2])
  }

  @Test fun theColdStartWindowStaysClosedWhileNothingHasBeenPublished() {
    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 10L)
    TunnelLinkStore.watchStarted()
    assertFalse(TunnelLinkStore.networkWatched)
    repeat(3) { assertEquals(1, untrustedColumn()) }
  }

  @Test fun aShieldsOffPublishDoesNotOpenTheWindow() {
    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 10L)
    TunnelLinkStore.watchStarted()
    TunnelLinkStore.save(prefs, on = false, untrusted = false, nowMs = 11L)
    assertFalse(TunnelLinkStore.networkWatched)
    assertTrue(served().isEmpty())
    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 12L)
    assertTrue(TunnelLinkStore.networkWatched)
    assertEquals(0, untrustedColumn())
  }

  @Test fun aPublishBeforeAnyWatchDoesNotOpenTheWindow() {
    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 10L)
    assertFalse(TunnelLinkStore.networkWatched)
    assertEquals(1, untrustedColumn())
  }

  @Test fun aPublishThatCouldNotBeSavedLeavesTheRowUntrusted() {
    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 10L)
    TunnelLinkStore.watchStarted()
    prefs.commitOk = false
    try {
      TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 20L)
      fail("a failed save must throw")
    } catch (expected: IllegalStateException) {
      assertEquals("Shields state not saved", expected.message)
    }
    assertFalse(TunnelLinkStore.networkWatched)
    assertEquals(1, untrustedColumn())
  }

  @Test fun stoppingTheWatchClosesTheWindowAgain() {
    TunnelLinkStore.watchStarted()
    TunnelLinkStore.save(prefs, on = true, untrusted = false, nowMs = 10L)
    assertEquals(0, untrustedColumn())
    TunnelLinkStore.watchStopped()
    assertEquals(1, untrustedColumn())
  }

  @Test fun anUntrustedNetworkIsServedUntrustedAfterTheFirstPublishToo() {
    TunnelLinkStore.watchStarted()
    TunnelLinkStore.save(prefs, on = true, untrusted = true, nowMs = 10L)
    assertArrayEquals(arrayOf<Any?>(1, 1, 10L), served().single())
  }

  @Test fun nothingIsServedBeforeAnyPublish() {
    assertNull(TunnelLinkStore.shield(prefs))
    assertTrue(served().isEmpty())
  }
}
