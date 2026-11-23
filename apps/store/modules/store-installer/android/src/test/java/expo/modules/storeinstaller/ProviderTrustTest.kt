package expo.modules.storeinstaller

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderTrustTest {
  private val deputy = "com.haroon.deputy"

  @Test fun expectedPackageSignedWithOurKeyIsRead() = assertTrue(ProviderTrust.allowed(deputy, deputy, signaturesMatch = true))

  @Test fun authorityClaimedByAnotherPackageIsNotRead() = assertFalse(ProviderTrust.allowed(deputy, "evil.squatter", signaturesMatch = true))

  @Test fun noProviderIsNotRead() = assertFalse(ProviderTrust.allowed(deputy, null, signaturesMatch = true))

  @Test fun signatureMismatchIsNotRead() = assertFalse(ProviderTrust.allowed(deputy, deputy, signaturesMatch = false))

  @Test fun unknownPackageIsNotRead() = assertFalse(ProviderTrust.allowed(deputy, null, signaturesMatch = false))

  @Test fun emptyExpectedPackageIsNotRead() = assertFalse(ProviderTrust.allowed("", "", signaturesMatch = true))
}
