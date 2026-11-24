package expo.modules.haloengine.core

import expo.modules.haloengine.applink.SiblingPackages

/** Who owns each share Halo reads, and the one place a read is allowed or refused. The trust check is a parameter so a JVM test can hand it any decision. */
object ShareOwners {
  val OWNER: Map<String, String> = mapOf(
    "com.haroon.netlens.applink" to SiblingPackages.HOMENET,
    "com.haroon.opentunnel.applink" to SiblingPackages.TUNNELWALL,
    "com.haroon.deputy.applink" to SiblingPackages.DEPUTY,
    "com.haroon.inflow.autopilot" to SiblingPackages.INFLOW,
  )

  /** No owner, or the trust check says no: no query, no rows. */
  fun read(share: ReadShare, trusted: (authority: String, owner: String) -> Boolean, query: (ReadShare) -> List<RawRow>): List<RawRow> {
    val owner = OWNER[share.authority] ?: return emptyList()
    return if (trusted(share.authority, owner)) query(share) else emptyList()
  }
}
