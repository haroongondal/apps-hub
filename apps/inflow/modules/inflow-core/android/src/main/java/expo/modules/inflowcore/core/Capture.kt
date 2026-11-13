package expo.modules.inflowcore.core

data class RawMessage(val sender: String?, val text: String, val time: Long)   // sender null = the owner

data class RawNotification(
  val pkg: String, val appLabel: String, val key: String, val postTime: Long,
  val ongoing: Boolean, val groupSummary: Boolean,
  val title: String?, val text: String?, val bigText: String?, val subText: String?,
  val conversationTitle: String?, val isGroupConversation: Boolean,
  val messages: List<RawMessage>, val textLines: List<String>,
)

data class Capture(
  val pkg: String, val appLabel: String,
  val sender: String?, val senderKey: String?,
  val conversation: String?, val conversationKey: String?,
  val title: String?, val text: String, val postedAt: Long,
  val hash: String, val deletedPlaceholder: Boolean,
)
