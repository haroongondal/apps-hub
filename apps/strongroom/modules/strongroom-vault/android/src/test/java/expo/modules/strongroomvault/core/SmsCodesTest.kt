package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SmsCodesTest {
  @Test fun aDigitRunNearAKeywordIsTheCode() {
    for (body in listOf(
      "Your verification code is 482913",
      "OTP: 482913",
      "G-482913 is your Strongroom code",
      "482913 is your login code",
      "2FA: 482913",
      "Aap ka verification code 482913 hai",
      "Bank: tasdeeq code 482913",
    )) {
      assertEquals(body, "482913", SmsCodes.extract(body))
    }
  }

  @Test fun theCandidateNearestAKeywordWins() {
    assertEquals("482913", SmsCodes.extract("Rs 25000 charged. Verification code 482913"))
  }

  @Test fun anAlphanumericRunHoldingADigitIsAFallback() {
    assertEquals("A1B2C3", SmsCodes.extract("Your verification code is A1B2C3"))
  }

  @Test fun nothingCodeLikeMeansNothing() {
    assertNull(SmsCodes.extract("Your balance is Rs 25,000.00"))
    assertNull(SmsCodes.extract("Thanks for your payment"))
    assertNull(SmsCodes.extract("code 123"))
    assertNull(SmsCodes.extract("code 1234567890"))
    assertNull(SmsCodes.extract("Your code is ABCDEF")) // a letter run is never a code on its own
  }

  @Test fun theCacheKeepsTheLastFewForTwoMinutes() {
    val t = 1_000_000L
    SmsCodes.clear()
    assertNull(SmsCodes.freshest(t))
    for (i in 1..6) SmsCodes.put(i.toString(), "0345", t + i)
    assertEquals("6", SmsCodes.freshest(t + 100)?.code) // 1 and 2 fell out, 6 is freshest
    assertEquals("6", SmsCodes.freshest(t + 6 + SmsCodes.TTL_MS)?.code) // alive through its last instant
    assertNull(SmsCodes.freshest(t + 6 + SmsCodes.TTL_MS + 1))
    SmsCodes.clear()
    assertNull(SmsCodes.freshest(t))
  }
}
