package expo.modules.inflowcore.core

import jakarta.mail.AuthenticationFailedException
import jakarta.mail.MessagingException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GmailPolicyTest {
  @Test fun authCopyOnlyForARefusedPassword() {
    assertEquals(GmailPolicy.AUTH_ERROR, GmailPolicy.errorCopy(AuthenticationFailedException("[AUTHENTICATIONFAILED] Invalid credentials (Failure)")))
    assertEquals(GmailPolicy.NETWORK_ERROR, GmailPolicy.errorCopy(AuthenticationFailedException("[UNAVAILABLE] Temporary system error")))
    assertEquals(GmailPolicy.NETWORK_ERROR, GmailPolicy.errorCopy(AuthenticationFailedException()))
    assertEquals(GmailPolicy.NETWORK_ERROR, GmailPolicy.errorCopy(MessagingException("AUTHENTICATIONFAILED")))
    assertEquals(GmailPolicy.NETWORK_ERROR, GmailPolicy.errorCopy(java.io.IOException("reset")))
  }

  @Test fun scheduledRunsStopWhileThePasswordIsRefused() {
    assertFalse(GmailPolicy.scheduledMayRun(GmailPolicy.AUTH_ERROR))
    assertTrue(GmailPolicy.scheduledMayRun(null))
    assertTrue(GmailPolicy.scheduledMayRun(GmailPolicy.NETWORK_ERROR))
  }
}
