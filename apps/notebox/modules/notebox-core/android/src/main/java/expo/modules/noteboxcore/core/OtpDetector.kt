package expo.modules.noteboxcore.core

object OtpDetector {
  val EXEMPT_PKGS: Set<String> = setOf(
    "com.whatsapp",
    "com.whatsapp.w4b",
    "org.telegram.messenger",
    "org.thoughtcrime.securesms",
    "com.facebook.orca",
    "com.instagram.android",
  )

  private val IGNORE = setOf(RegexOption.IGNORE_CASE)
  private const val EDGE_BEFORE = "(?<![\\p{L}\\p{N}\\p{M}])"
  private const val EDGE_AFTER = "(?![\\p{L}\\p{N}\\p{M}])"

  private val KEYWORD = Regex(
    EDGE_BEFORE + "(?:otp|one-time|one time|verification|verify|code|pin|passcode|password|کوڈ)" + EDGE_AFTER,
    IGNORE,
  )

  // Not inside a longer digit run, a comma-grouped number (25,000) or a decimal (1,500.00).
  private val DIGIT_TOKEN = Regex("(?<!\\d)(?<!\\d[,.])\\d{4,8}(?!\\d)(?![,.]\\d)")

  private val AMOUNT = Regex(EDGE_BEFORE + "(?:PKR|Rs\\.?|USD)\\s?[\\d,]+(?:\\.\\d+)?", IGNORE)
  private val TRANSACTION_VERB = Regex(
    EDGE_BEFORE + "(?:credited|debited|charged|received|transferred|sent|paid|withdrawn)" + EDGE_AFTER,
    IGNORE,
  )

  fun isOtp(pkg: String, text: String): Boolean {
    if (pkg in EXEMPT_PKGS) return false
    if (!KEYWORD.containsMatchIn(text) || !DIGIT_TOKEN.containsMatchIn(text)) return false
    val looksLikeTransaction = AMOUNT.containsMatchIn(text) && TRANSACTION_VERB.containsMatchIn(text)
    return !looksLikeTransaction
  }
}
