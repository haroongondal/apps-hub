package expo.modules.haloengine.core

/** Who may serve each share authority Halo reads. Another app can claim an authority first, so a reader checks the provider's package and signer before it queries. */
object ProviderTrust {
  val EXPECTED: Map<String, String> = mapOf(
    "com.haroon.netlens.applink" to "app.netlens",
    "com.haroon.opentunnel.applink" to "com.opentunnel.open_tunnel_vpn",
    "com.haroon.deputy.applink" to "com.haroon.deputy",
    "com.haroon.strongroom.applink" to "com.haroon.strongroom",
    "com.haroon.inflow.autopilot" to "com.haroon.inflow",
    "com.haroon.pdfeditor.applink" to "com.haroon.pdfeditor",
  )

  fun expectedPackage(authority: String): String? = EXPECTED[authority]

  fun allowed(expectedPackage: String?, resolvedPackage: String?, signaturesMatch: Boolean): Boolean =
    expectedPackage != null && resolvedPackage == expectedPackage && signaturesMatch
}
