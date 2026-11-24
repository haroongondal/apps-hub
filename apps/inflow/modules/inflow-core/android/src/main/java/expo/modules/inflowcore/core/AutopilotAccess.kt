package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.SiblingPackages

/** The one message Deputy may read for a run. `sender` is the contact's saved name when there is one. */
data class AutopilotItem(val id: Long, val app: String, val pkg: String, val sender: String?, val conversation: String?, val text: String, val at: Long)

/** What the provider reads through; the SQL one is SqlItemStore, the twin used in JVM tests is MemoryItemStore. Null means Inflow refuses. */
interface AutopilotItems {
  /** Served only while a live (waiting or started, not past expiresAt at `now`) REPLY suggestion names the item: full text crosses for the suggestion being run, never in bulk. */
  fun autopilotItem(id: Long, now: Long): AutopilotItem?
}

/** An item crosses to Deputy only if Inflow could send it to the AI (the send queue's filter) and its app is not Strongroom or Inflow. */
object AutopilotAccess {
  /** Equal to packages/autopilot-contract/fixtures/never-share.json; AutopilotAccessTest checks it. */
  val NEVER_SHARE: Set<String> = setOf("com.haroon.strongroom", "com.haroon.inflow")

  /** `'a','b'` for an SQL IN list. The values are constants, never user input. */
  val SQL_LIST: String = NEVER_SHARE.joinToString(",") { "'$it'" }

  fun mayShare(pkg: String, inQueueFilter: Boolean): Boolean = pkg !in NEVER_SHARE && inQueueFilter

  /** `items/#` (message text) is for Deputy alone: the uid must hold exactly one package, com.haroon.deputy. */
  fun callerIsDeputy(packages: Array<String>?): Boolean = packages != null && packages.size == 1 && packages[0] == SiblingPackages.DEPUTY
}
