package expo.modules.aihubcore.core

sealed class Decision {
  object Allow : Decision()
  data class Deny(val reason: String) : Decision()
}

object CallerPolicy {
  const val STRONGROOM = "com.haroon.strongroom"

  fun decide(
    pkg: String,
    sameSignature: Boolean,
    switches: Map<String, Boolean>,
    hubPackage: String,
  ): Decision = when {
    pkg == STRONGROOM -> Decision.Deny("Strongroom is never allowed. Vault data stays in Strongroom.")
    pkg == hubPackage -> Decision.Allow
    !sameSignature -> Decision.Deny("This app is not signed by the same owner as the hub.")
    switches[pkg] == false -> Decision.Deny("You turned AI off for this app.")
    else -> Decision.Allow
  }
}
