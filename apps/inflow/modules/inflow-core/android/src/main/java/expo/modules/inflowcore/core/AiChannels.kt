package expo.modules.inflowcore.core

/**
 * R44: only SMS and email reach the AI. These packages are always eligible; an item is also eligible when it has an
 * `sms_hash` or `email_hash`, which covers the default SMS app's items whatever its package (the importer sets the hash).
 *
 * The one exception (owner, 2026-11-18): items from conversations the owner picked for Autopilot go to the AI, for Autopilot only.
 * That widening lives in `SqlItemStore.queueFilter`, used by the send queue alone. Ask AI (`askItems`, `askTxns`) and the ledger
 * keep `NEVER_SEND_FILTER`, so a picked WhatsApp chat is never offered to a question.
 */
object AiChannels {
  val PKGS: Set<String> = Sms.KNOWN_APPS + Email.GMAIL

  /** `'a','b'` for an SQL IN list. The values are constants, never user input. */
  val SQL_LIST: String = PKGS.joinToString(",") { "'$it'" }
}
