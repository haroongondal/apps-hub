package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OtpDetectorTest {
  private val sms = "com.google.android.apps.messaging"

  private val alfalahCredit = "Dear Customer,\n" +
    "PKR 593,249.01 Credited to your A/C: 0847-1***2310 on 13-Nov-26 at 12:02:54\n" +
    "Bal: Reply with AB\n" +
    "021111225111"
  private val alfalahDebit = "Dear Customer,\n" +
    "Your Debit Card against A/C: 0847-1***2310 is charged for PKR 1,500.00 on 12-Nov-26 at 16:23:38 " +
    "at SHAAFI INTERNATIONAL HOSPIslamabad PK."
  private val ublRaast = "PKR 50,000 received from HAROON MUKHTAR* in your UBL A/C *1733 on 01-OCT-2026 21:03 " +
    "via your Raast ID. Tx ID 7224343340. For info 111825888."
  private val jazz = "Mahana 5GB 12 ghantay main khatam ho jaye gi. Mazeed data ke liye Jazz World app dekhein."
  private val jazzWithKeywordNoDigits = "Mahana 5GB 12 ghantay main khatam ho jaye gi. " +
    "Verification ke baghair data nahi milega, Jazz World app dekhein."

  @Test fun ownerSamplesAreNotOtp() {
    for (text in listOf(alfalahCredit, alfalahDebit, ublRaast, jazz, jazzWithKeywordNoDigits)) {
      assertFalse(text, OtpDetector.isOtp(sms, text))
    }
  }

  @Test fun plainOtps() {
    assertTrue(OtpDetector.isOtp(sms, "Your OTP is 482913. Do not share it."))
    assertTrue(OtpDetector.isOtp(sms, "123456 is your verification code"))
  }

  @Test fun otpNamingAnAmountIsStillOtp() {
    assertTrue(OtpDetector.isOtp(sms, "OTP 123456 for PKR 25,000 at Daraz"))
  }

  @Test fun transactionWithPinWordIsNot() {
    assertFalse(
      OtpDetector.isOtp(sms, "PKR 1,500.00 charged to your card. Never share your PIN 0000 with anyone"),
    )
  }

  @Test fun chatAppsExempt() {
    assertFalse(OtpDetector.isOtp("com.whatsapp", "code 4455"))
    assertFalse(OtpDetector.isOtp("com.whatsapp", "my pin is 4455"))
    for (pkg in OtpDetector.EXEMPT_PKGS) assertFalse(pkg, OtpDetector.isOtp(pkg, "OTP 482913"))
    assertEquals(
      setOf(
        "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger",
        "org.thoughtcrime.securesms", "com.facebook.orca", "com.instagram.android",
      ),
      OtpDetector.EXEMPT_PKGS,
    )
  }

  @Test fun keywordsMatchWholeWordsAnyCase() {
    assertTrue(OtpDetector.isOtp(sms, "ONE-TIME password 5521"))
    assertTrue(OtpDetector.isOtp(sms, "Use One Time passcode 5521 to log in"))
    assertTrue(OtpDetector.isOtp(sms, "Please verify with 5521"))
    assertFalse(OtpDetector.isOtp(sms, "Decoded 5521 items"))
    assertFalse(OtpDetector.isOtp(sms, "Spinning 5521 times"))
  }

  @Test fun urduKeywordMatches() {
    assertTrue(OtpDetector.isOtp(sms, "آپ کا کوڈ 482913 ہے"))
    assertFalse(OtpDetector.isOtp(sms, "آپ کا کوڈ ہے"))
  }

  @Test fun needsAStandaloneFourToEightDigitToken() {
    assertFalse(OtpDetector.isOtp(sms, "Your code is 123"))
    assertFalse(OtpDetector.isOtp(sms, "Your code is 123456789"))
    assertTrue(OtpDetector.isOtp(sms, "Your code is 12345678"))
    assertFalse(OtpDetector.isOtp(sms, "Your code will arrive soon"))
  }

  @Test fun amountsAndDecimalsAreNotTokens() {
    assertFalse(OtpDetector.isOtp(sms, "Reset your password to get PKR 12,3456 off"))
    assertFalse(OtpDetector.isOtp(sms, "Verification fee is 1500.50 today"))
    assertFalse(OtpDetector.isOtp(sms, "Verify balance 1,500.00 now"))
  }
}
