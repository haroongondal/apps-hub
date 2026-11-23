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

  @Test fun callActions_find_speaker_and_hang_up_by_title() {
    assertEquals(CallActions(speaker = 1, hangUp = 2), callActions(listOf("Mute", "Speaker", "Hang up")))
    assertEquals(CallActions(speaker = 0, hangUp = 1), callActions(listOf("Lautsprecher", "Auflegen")))
    assertEquals(CallActions(speaker = 1, hangUp = 0), callActions(listOf("挂断", "免提")))
    assertEquals(CallActions(speaker = -1, hangUp = 0), callActions(listOf("Decline", "Answer")))
  }

  @Test fun callActions_hide_what_is_not_found() {
    assertEquals(CallActions(-1, -1), callActions(emptyList()))
    assertEquals(CallActions(-1, -1), callActions(listOf("Mute", null, "Send message", "Weekend")))
  }

  @Test fun titleMatches_ascii_words_stand_alone() {
    assertTrue(titleMatches("END CALL", listOf("end")))
    assertFalse(titleMatches("Send", listOf("end")))
    assertTrue(titleMatches("Turn off alarm", listOf("turn off")))
    assertFalse(titleMatches(null, listOf("end")))
  }
}
