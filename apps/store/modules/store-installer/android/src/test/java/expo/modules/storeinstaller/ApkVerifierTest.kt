package expo.modules.storeinstaller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApkVerifierTest {
  private val cert = "e3af4a92b1e858ede650bf53521c9be86702036100b2dc07393a262748d0317d"
  private val sha = ApkVerifier.sha256("apk".toByteArray())

  private fun check(pkg: String? = "app.netlens", actualSha: String = sha, certs: List<String> = listOf(cert)) =
    ApkVerifier.mismatch("app.netlens", sha.uppercase(), cert.uppercase(), pkg, actualSha, certs)

  @Test fun hexIsLowercaseAndUnsigned() = assertEquals("00ff7f80", ApkVerifier.hex(byteArrayOf(0, -1, 127, -128)))

  @Test fun sha256MatchesKnownVector() =
    assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ApkVerifier.sha256(ByteArray(0)))

  @Test fun acceptsMatchingApk() = assertNull(check())

  @Test fun rejectsTamperedBytes() = assertEquals("SHA-256 mismatch", check(actualSha = "0".repeat(64)))

  @Test fun rejectsWrongPackage() = assertEquals("package is evil.app, expected app.netlens", check(pkg = "evil.app"))

  @Test fun rejectsUnparseableArchive() = assertEquals("package is null, expected app.netlens", check(pkg = null))

  @Test fun rejectsForeignOrExtraSigner() {
    assertEquals("signing certificate mismatch", check(certs = listOf("1".repeat(64))))
    assertEquals("signing certificate mismatch", check(certs = listOf(cert, "1".repeat(64))))
    assertEquals("signing certificate mismatch", check(certs = emptyList()))
  }
}
