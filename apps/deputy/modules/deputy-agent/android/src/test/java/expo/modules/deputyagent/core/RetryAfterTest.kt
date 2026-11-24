package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RetryAfterTest {
  private val noon = java.time.Instant.parse("2026-11-23T12:00:00Z").toEpochMilli()

  @Test fun secondsAreWholeOrFractional() {
    assertEquals(20_000L, RetryAfter.parse("20", noon))
    assertEquals(1_500L, RetryAfter.parse(" 1.5 ", noon))
  }

  @Test fun anHttpDateIsCountedFromNow() {
    assertEquals(45_000L, RetryAfter.parse("Mon, 23 Nov 2026 12:00:45 GMT", noon))
  }

  @Test fun aDateAlreadyPastOrANegativeNumberMeansNoExtraWait() {
    assertEquals(0L, RetryAfter.parse("Mon, 23 Nov 2026 11:59:00 GMT", noon))
    assertEquals(0L, RetryAfter.parse("-5", noon))
  }

  @Test fun noHeaderOrGibberishIsNoHint() {
    assertNull(RetryAfter.parse(null, noon))
    assertNull(RetryAfter.parse("soon", noon))
  }
}
