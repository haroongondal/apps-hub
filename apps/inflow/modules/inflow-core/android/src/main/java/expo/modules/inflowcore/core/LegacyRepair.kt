package expo.modules.inflowcore.core

/** What the v5 migration needs to know about one saved WhatsApp item. */
data class LegacyRow(
  val id: Long, val pkg: String, val sender: String?, val conversationKey: String?, val conversation: String?,
  val title: String?, val text: String, val postedAt: Long, val capturedAt: Long,
  /** A ledger source or an item with to-dos: it is moved, never deleted, even with an identical twin. */
  val inUse: Boolean = false,
)

sealed class LegacyAction {
  /** An identical copy (same pkg, sender, time and text) stays. */
  data class Delete(val id: Long) : LegacyAction()
  data class Move(val id: Long, val conversation: String, val conversationKey: String, val hash: String, val search: String) : LegacyAction()
}

/**
 * Stage 4 filed a WhatsApp chat under the conversation "You" once the owner had replied (the notification title turned into "You"),
 * and saved the contact's messages a second time there. This decides, as a pure function, what the v5 migration does about it.
 * It only ever deletes a row whose identical twin stays and that nothing else points at; SQL just carries the plan out.
 */
object LegacyRepair {
  const val PKG = "com.whatsapp"
  const val NEAR_MS = 5 * 60_000L

  fun plan(rows: List<LegacyRow>): List<LegacyAction> {
    val wa = rows.filter { it.pkg == PKG }
    val youKey = senderKey(PKG, NotificationParser.YOU)
    val stray = wa.filter { it.conversationKey == youKey && it.sender != null }.sortedBy { it.id }
    val strayIds = stray.map { it.id }.toSet()
    fun isYou(r: LegacyRow) = r.sender.equals(NotificationParser.YOU, ignoreCase = true)

    // The thread a stray row belongs in (null = nothing to go by, it stays).
    fun targetOf(r: LegacyRow): Pair<String, String>? = when {
      !isYou(r) -> r.sender!!.let { it to senderKey(PKG, it) }
      else -> (wa.filter { it.sender != null && !isYou(it) && it.conversationKey != null }
        .filter { Math.abs(it.capturedAt - r.capturedAt) <= NEAR_MS }
        .minWithOrNull(compareBy<LegacyRow>({ Math.abs(it.capturedAt - r.capturedAt) }, { it.id })))
        ?.let { n -> if (n.id in strayIds) n.sender!!.let { it to senderKey(PKG, it) } else n.conversation!! to n.conversationKey!! }
    }

    return stray.mapNotNull { r ->
      val (conversation, key) = targetOf(r) ?: return@mapNotNull null
      val twin = if (!isYou(r)) {
        wa.any { it.id != r.id && it.sender == r.sender && it.postedAt == r.postedAt && it.text == r.text && (it.id !in strayIds || it.id < r.id) }
      } else {
        wa.any { it.id != r.id && it.sender == r.sender && it.postedAt == r.postedAt && it.text == r.text && (it.conversationKey == key || (it.id in strayIds && it.id < r.id)) }
      }
      if (twin && !r.inUse) return@mapNotNull LegacyAction.Delete(r.id)
      val sender = r.sender!!
      LegacyAction.Move(
        r.id, conversation, key, NotificationParser.messageHash(PKG, key, sender, r.postedAt, r.text),
        SearchText.normalize(listOfNotNull(sender, conversation, r.title, r.text).joinToString(" ")),
      )
    }
  }
}
