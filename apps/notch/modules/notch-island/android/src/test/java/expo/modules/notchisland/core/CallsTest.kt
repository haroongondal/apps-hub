package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CallsTest {
  @Test fun callElapsed_null_for_non_call() {
    assertNull(callElapsed("msg", 0, 5_000))
    assertNull(callElapsed(null, 0, 5_000))
  }

  @Test fun callElapsed_counts_from_start() {
    assertEquals(192_000L, callElapsed("call", 1_000, 193_000))
  }

  @Test fun callElapsed_zero_when_start_in_future() {
    assertEquals(0L, callElapsed("call", 9_000, 1_000))
  }

  @Test fun callElapsed_zero_when_start_missing() {
    assertEquals(0L, callElapsed("call", 0, 5_000))
  }

  // Explicit indices: the real constants stay -1 until the phone probe in Task 10.
  @Test fun endAvailable_only_when_hangup_index_exists() {
    assertTrue(endAvailable(2, index = 1))
    assertFalse(endAvailable(1, index = 1))
  }

  @Test fun speakerAvailable_false_when_no_speaker_action() {
    assertFalse(speakerAvailable(3, index = -1))
  }
}
