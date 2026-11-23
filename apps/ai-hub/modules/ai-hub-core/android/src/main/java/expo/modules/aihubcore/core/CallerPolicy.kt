package expo.modules.aihubcore.core

sealed class Decision {
  object Allow : Decision()

  // `ask`: a same-signed package the owner has not decided on yet, so the hub lists it for the owner to allow.
  data class Deny(val reason: String, val ask: String? = null) : Decision()
}

// Default deny: a same-signed app is let in only after the owner turns it on in the hub.
object CallerPolicy {
  const val STRONGROOM = "com.haroon.strongroom"
  const val NOT_ON = "Turn AI on for this app in AI hub."

  fun decide(
    pkg: String,
    sameSignature: Boolean,
    switches: Map<String, Boolean>,
    hubPackage: String,
  ): Decision = when {
    pkg == STRONGROOM -> Decision.Deny("Strongroom is never allowed. Vault data stays in Strongroom.")
    pkg == hubPackage -> Decision.Allow
    !sameSignature -> Decision.Deny("This app is not signed by the same owner as the hub.")
    switches[pkg] == true -> Decision.Allow
    switches[pkg] == false -> Decision.Deny("You turned AI off for this app.")
    else -> Decision.Deny(NOT_ON, ask = pkg)
  }
}
