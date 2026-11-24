package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.SiblingPackages

data class NexusAskItem(val id: Long, val app: String, val sender: String?, val text: String, val at: Long)

// Served to Nexus alone; columns equal packages/autopilot-contract/fixtures/{ask-items,ask-ids,debits}.share.json and Nexus's Readers.SPECS. Any doubt serves nothing.
object NexusShares {
  const val ASK_META = "nexusAsk"
  const val DEBITS_META = "nexusDebits"
  const val ASK_ITEMS_PATH = "ask_items"
  const val ASK_IDS_PATH = "ask_ids"
  const val DEBITS_PATH = "debits"
  val ASK_ITEMS_COLUMNS = arrayOf("id", "app", "sender", "text", "at")
  val ASK_IDS_COLUMNS = arrayOf("id")
  val DEBITS_COLUMNS = arrayOf("id", "amount_minor", "at", "merchant", "account")
  const val PAGE = 200
  const val MAX_DEBITS = 500
  const val DEBIT_DAYS = 60L
  const val MAX_TEXT = 4000
  const val MAX_LABEL = 80
  const val MAX_SAFE_LONG = 9_007_199_254_740_991L
  private const val DAY_MS = 86_400_000L

  fun callerIsNexus(packages: Array<String>?): Boolean = packages != null && packages.size == 1 && packages[0] == SiblingPackages.NEXUS

  fun since(packages: Array<String>?, switchMeta: String?, segment: String?): Long? {
    if (!callerIsNexus(packages) || !Briefing.on(switchMeta)) return null
    if (segment.isNullOrEmpty() || segment.length > MAX_SAFE_LONG.toString().length || !segment.all { it in '0'..'9' }) return null
    return segment.toLong().takeIf { it <= MAX_SAFE_LONG }
  }

  fun debitsFrom(now: Long): Long = now - DEBIT_DAYS * DAY_MS

  fun askRow(item: NexusAskItem): Array<Any?>? {
    if (!validId(item.id) || item.at < 0) return null
    val app = Briefing.clean(item.app, MAX_LABEL)
    val text = cap(item.text.replace(CONTROL, " "), MAX_TEXT)
    if (app.isEmpty() || text.isBlank()) return null
    return arrayOf(item.id, app, item.sender?.let { Briefing.clean(it, MAX_LABEL) }?.ifEmpty { null }, text, item.at)
  }

  fun idRow(id: Long): Array<Any?>? = if (validId(id)) arrayOf(id) else null

  fun debitRow(t: Txn, now: Long): Array<Any?>? {
    if (!validId(t.id) || t.direction != Direction.OUT || t.own || t.amountMinor <= 0 || t.amountMinor > MAX_SAFE_LONG || t.at < debitsFrom(now)) return null
    return arrayOf(t.id, t.amountMinor, t.at, Briefing.clean(t.label ?: t.counterparty ?: "", MAX_LABEL), accountLabel(t.account))
  }

  // Keeps at most the last four digits of the whole string, however the number is spaced, so a full card, account or IBAN number never comes out.
  fun accountLabel(account: String): String {
    val digits = account.filter(Char::isDigit)
    val words = account.split(Regex("[\\s\\p{Nd}*•#./:_-]+")).filter { w -> w.isNotEmpty() && !w.all { it == 'x' || it == 'X' } }
    val name = Briefing.clean(words.joinToString(" "), MAX_LABEL - 9)
    val tail = if (digits.isEmpty()) "" else "****" + digits.takeLast(4)
    return listOf(name, tail).filter(String::isNotEmpty).joinToString(" ")
  }

  private val CONTROL = Regex("[\\p{Cc}&&[^\\n\\t]]")

  private fun validId(id: Long) = id in 1..MAX_SAFE_LONG

  private fun cap(text: String, max: Int): String =
    if (text.length <= max) text else text.substring(0, if (text[max - 1].isHighSurrogate()) max - 1 else max)
}
