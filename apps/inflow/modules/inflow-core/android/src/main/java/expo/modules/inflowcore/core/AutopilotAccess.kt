package expo.modules.inflowcore.core

/** The one message Deputy may read for a run. `sender` is the contact's saved name when there is one. */
data class AutopilotItem(val id: Long, val app: String, val pkg: String, val sender: String?, val conversation: String?, val text: String, val at: Long)

/** What the provider reads through; the SQL one is SqlItemStore, the twin used in JVM tests is MemoryItemStore. Null means Inflow refuses. */
interface AutopilotItems {
  fun autopilotItem(id: Long): AutopilotItem?
}

/** An item crosses to Deputy only if Inflow could send it to the AI (the send queue's filter) and its app is not Strongroom or Inflow. */
object AutopilotAccess {
  /** Equal to packages/autopilot-contract/fixtures/never-share.json; AutopilotAccessTest checks it. */
  val NEVER_SHARE: Set<String> = setOf("com.haroon.strongroom", "com.haroon.inflow")

  fun mayShare(pkg: String, inQueueFilter: Boolean): Boolean = pkg !in NEVER_SHARE && inQueueFilter
}
