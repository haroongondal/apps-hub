package expo.modules.inflowcore.core

fun interface ProviderOwner {
  fun packageOf(authority: String): String?
}

fun interface SameKey {
  fun matches(packageName: String): Boolean
}

// Any app can declare another app's authority (installed first, or a debug-signed lookalike), so a reader trusts a provider only when the expected sibling owns it and is signed with Inflow's key.
object SiblingIdentity {
  val PACKAGES: Map<String, String> = mapOf(
    "com.haroon.netlens.applink" to "app.netlens",
    "com.haroon.deputy.applink" to "com.haroon.deputy",
    "com.haroon.strongroom.applink" to "com.haroon.strongroom",
    "com.haroon.pdfeditor.applink" to "com.haroon.pdfeditor",
    "com.haroon.opentunnel.applink" to "com.opentunnel.open_tunnel_vpn",
    "com.haroon.clipboard.applink" to "com.haroon.clipboard",
    "com.haroon.halo.applink" to "com.haroon.halo",
    "com.haroon.designeditor.applink" to "com.haroon.designeditor",
    "com.haroon.aihub.applink" to "com.haroon.aihub",
  )

  fun allowed(expectedPackage: String?, resolvedPackage: String?, signaturesMatch: Boolean): Boolean =
    expectedPackage != null && resolvedPackage == expectedPackage && signaturesMatch

  fun trusted(authority: String, owner: ProviderOwner, sameKey: SameKey): Boolean {
    val expected = PACKAGES[authority] ?: return false
    val resolved = runCatching { owner.packageOf(authority) }.getOrNull()
    return allowed(expected, resolved, resolved == expected && runCatching { sameKey.matches(expected) }.getOrDefault(false))
  }
}
