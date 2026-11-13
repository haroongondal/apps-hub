package expo.modules.inflowcore.core

enum class Direction { IN, OUT }

data class Parsed(
  val direction: Direction, val amountMinor: Long, val currency: String,
  val account: String,
  val counterparty: String?,
  val txId: String?,
)

object BankParser {
  private val FLAGS = setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)
  private const val AMT = "PKR\\s+([\\d,]+(?:\\.\\d+)?)"
  // Masked account numbers (0847-1***2310): only the last four digits are kept.
  private const val ACCT = "A/C:?\\s*[\\d*\\-x]*?(\\d{4})(?![\\d*\\-x])"

  private val ALFALAH_CREDIT = Regex("$AMT\\s+Credited\\s+to\\s+your\\s+$ACCT", FLAGS)
  private val ALFALAH_DEBIT = Regex(
    "Debit\\s+Card\\s+against\\s+$ACCT\\s+is\\s+charged\\s+for\\s+$AMT\\s+on\\s+.+?\\s+at\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s+at\\s+(.+?)\\.?\\s*$",
    FLAGS,
  )
  private val UBL_RAAST = Regex(
    "$AMT\\s+received\\s+from\\s+(.+?)\\s+in\\s+your\\s+UBL\\s+A/C\\s*\\*?(\\d{4})(?!\\d)(?:.*?Tx\\s*ID\\s*:?\\s*(\\d+))?",
    FLAGS,
  )
  private val SPACES = Regex("\\s+")

  fun parse(text: String): Parsed? {
    ALFALAH_CREDIT.find(text)?.let { m ->
      return parsed(Direction.IN, m.groupValues[1], "Alfalah ${m.groupValues[2]}", null, null)
    }
    ALFALAH_DEBIT.find(text)?.let { m ->
      val merchant = m.groupValues[3].replace(SPACES, " ").trim()
      return parsed(Direction.OUT, m.groupValues[2], "Alfalah ${m.groupValues[1]}", merchant.ifEmpty { null }, null)
    }
    UBL_RAAST.find(text)?.let { m ->
      return parsed(Direction.IN, m.groupValues[1], "UBL ${m.groupValues[3]}", m.groupValues[2].replace(SPACES, " "), m.groups[4]?.value)
    }
    return null
  }

  private fun parsed(d: Direction, amount: String, account: String, counterparty: String?, txId: String?): Parsed? {
    val minor = minor(amount) ?: return null
    return Parsed(d, minor, "PKR", account, counterparty, txId)
  }

  private fun minor(amount: String): Long? {
    val whole = amount.substringBefore('.').replace(",", "")
    val frac = amount.substringAfter('.', "")
    // More than two decimals is not a bank amount; skipping beats guessing money.
    if (frac.length > 2 || whole.isEmpty()) return null
    val w = whole.toLongOrNull() ?: return null
    if (w > Long.MAX_VALUE / 100 - 1) return null
    return w * 100 + frac.padEnd(2, '0').toLong()
  }
}
