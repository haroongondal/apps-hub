package expo.modules.storeinstaller

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeadlineTest {
  @Test fun returnsTheResultInTime() = runBlocking {
    assertEquals("row", Deadline.within(1_000) { "row" })
  }

  @Test fun givesUpOnABlockedCallWithoutWaitingForIt() = runBlocking {
    val start = System.nanoTime()
    val result = Deadline.within(100) { Thread.sleep(5_000); "late" }
    val waitedMs = (System.nanoTime() - start) / 1_000_000
    assertNull(result)
    assertTrue("waited $waitedMs ms", waitedMs < 1_000)
  }

  @Test fun aFailingBlockIsNoResult() = runBlocking {
    assertNull(Deadline.within(1_000) { error("provider broke") })
  }
}
