package expo.modules.nexuslinks.core

import expo.modules.nexuslinks.applink.SiblingPackages

/**
 * The two apps Nexus can open from its "Install AI hub" and "Open AI hub" buttons. The Store is not in the sibling table,
 * so this applies the same sender rule (the launch component must belong to the expected package, signed like Nexus) to both.
 */
object Opens {
  const val STORE = "com.haroon.store"

  val APPS: Map<String, String> = mapOf("store" to STORE, "ai-hub" to SiblingPackages.AI_HUB)

  fun packageOf(app: String): String? = APPS[app]

  fun trusted(expectedPackage: String, launchPackage: String?, signaturesMatch: Boolean): Boolean =
    expectedPackage in APPS.values && launchPackage == expectedPackage && signaturesMatch
}
