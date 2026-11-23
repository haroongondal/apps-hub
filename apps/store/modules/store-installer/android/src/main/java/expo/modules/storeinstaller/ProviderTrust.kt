package expo.modules.storeinstaller

object ProviderTrust {
  // Any app can claim an authority first; only the expected package, signed with the Store's key, is read.
  fun allowed(expectedPackage: String, resolvedPackage: String?, signaturesMatch: Boolean): Boolean =
    expectedPackage.isNotEmpty() && resolvedPackage == expectedPackage && signaturesMatch
}
