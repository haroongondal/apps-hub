package expo.modules.storeinstaller

import java.security.MessageDigest

object ApkVerifier {
  fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

  fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

  /** Returns why the downloaded APK must not be installed, or null when it matches the manifest. */
  fun mismatch(
    expectedPackage: String,
    expectedSha256: String,
    expectedCertSha256: String,
    actualPackage: String?,
    actualSha256: String,
    actualCertSha256s: List<String>,
  ): String? = when {
    !actualSha256.equals(expectedSha256, ignoreCase = true) -> "SHA-256 mismatch"
    actualPackage != expectedPackage -> "package is $actualPackage, expected $expectedPackage"
    actualCertSha256s != listOf(expectedCertSha256.lowercase()) -> "signing certificate mismatch"
    else -> null
  }
}
