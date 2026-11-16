package expo.modules.inflowcore.core

/** own = the owner wrote it (sender null, "You", or the platform said so). */
data class RawMessage(val sender: String?, val text: String, val time: Long, val own: Boolean = false)

data class RawNotification(
  val pkg: String, val appLabel: String, val key: String, val postTime: Long,
  val ongoing: Boolean, val groupSummary: Boolean,
  val title: String?, val text: String?, val bigText: String?, val subText: String?,
  val conversationTitle: String?, val isGroupConversation: Boolean,
  val messages: List<RawMessage>, val textLines: List<String>,
  val chatTag: String? = null, val shortcutId: String? = null,   // stable per-chat ids (WhatsApp: sbn tag, shortcut like "<digits>@lid")
)

/** Remembers which contact a chat id belongs to, so a reply-only notification still lands in the contact's thread. */
interface ChatDirectory {
  fun nameFor(tag: String): String?
  fun learn(tag: String, name: String)
}

data class Capture(
  val pkg: String, val appLabel: String,
  val sender: String?, val senderKey: String?,
  val conversation: String?, val conversationKey: String?,
  val title: String?, val text: String, val postedAt: Long,
  val hash: String, val deletedPlaceholder: Boolean,
)
