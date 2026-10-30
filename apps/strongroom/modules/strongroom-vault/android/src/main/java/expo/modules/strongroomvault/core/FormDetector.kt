package expo.modules.strongroomvault.core

import java.util.Locale

data class FieldNode(
  val index: Int,
  val hints: List<String>,
  val inputType: Int,
  val htmlType: String?,
  val htmlAutocomplete: String?,
  val htmlName: String?,
  val idEntry: String?,
  val hintText: String?,
  val webDomain: String?,
)

data class CardFields(val number: Int?, val holder: Int?, val expMonth: Int?, val expYear: Int?, val expDate: Int?, val cvc: Int?)

data class DetectedForm(val username: Int?, val password: Int?, val newPassword: Int?, val card: CardFields?)

object FormDetector {
  // View.AUTOFILL_HINT_* / androidx HintConstants and android.text.InputType, copied (checked against android-36) so core/ has no Android imports.
  private val HINT_ROLES = mapOf(
    "username" to Role.USERNAME,
    "newUsername" to Role.USERNAME,
    "emailAddress" to Role.USERNAME_CANDIDATE,
    "password" to Role.PASSWORD,
    "newPassword" to Role.NEW_PASSWORD,
    "creditCardNumber" to Role.CC_NUMBER,
    "creditCardSecurityCode" to Role.CC_CVC,
    "creditCardExpirationDate" to Role.CC_DATE,
    "creditCardExpirationMonth" to Role.CC_MONTH,
    "creditCardExpirationYear" to Role.CC_YEAR,
    "personName" to Role.CC_HOLDER,
    "creditCardExpirationDay" to Role.OTHER,
    "smsOTPCode" to Role.OTHER,
    "emailOTPCode" to Role.OTHER,
    "2faAppOTPCode" to Role.OTHER,
    "oneTimeCode" to Role.OTHER,
    "name" to Role.OTHER,
    "phone" to Role.OTHER,
    "postalAddress" to Role.OTHER,
    "postalCode" to Role.OTHER,
  ).mapKeys { it.key.lowercase(Locale.ROOT) }
  private val AUTOCOMPLETE_ROLES = mapOf(
    "username" to Role.USERNAME,
    "email" to Role.USERNAME_CANDIDATE,
    "current-password" to Role.PASSWORD,
    "new-password" to Role.NEW_PASSWORD,
    "cc-number" to Role.CC_NUMBER,
    "cc-csc" to Role.CC_CVC,
    "cc-exp" to Role.CC_DATE,
    "cc-exp-month" to Role.CC_MONTH,
    "cc-exp-year" to Role.CC_YEAR,
    "cc-name" to Role.CC_HOLDER,
    "one-time-code" to Role.OTHER,
  )
  private const val CLASS_MASK = 0xf
  private const val VARIATION_MASK = 0xff0
  private const val CLASS_TEXT = 1
  private const val CLASS_NUMBER = 2
  private const val NUMBER_PASSWORD = 0x10
  private const val TEXT_VISIBLE_PASSWORD = 0x90
  private val TEXT_PASSWORDS = setOf(0x80, 0xe0)
  private val TEXT_EMAILS = setOf(0x20, 0xd0)
  private const val RANK_HINT = 0
  private const val RANK_AUTOCOMPLETE = 1
  private const val RANK_TYPE = 2
  private const val RANK_VISIBLE_TYPE = 3
  private const val RANK_NUMBER_TYPE = 4
  private const val RANK_KEYWORD = 5
  private val SPACE = Regex("\\s+")
  private val CAMEL_HUMP = Regex("([a-z0-9])([A-Z])")
  private val PASSWORD_WORD = Regex("(?<![a-z])(pass(word|wd|code|phrase)(?![a-z])|pass$)")
  private val USER_WORD = Regex("user|email|login")
  private val HTML_TYPES = setOf("text", "email", "password", "tel", "number")

  private enum class Role { USERNAME, USERNAME_CANDIDATE, PASSWORD, NEW_PASSWORD, CC_NUMBER, CC_HOLDER, CC_MONTH, CC_YEAR, CC_DATE, CC_CVC, OTHER }

  private class Hit(val index: Int, val role: Role, val rank: Int)

  fun detect(nodes: List<FieldNode>): DetectedForm {
    val sorted = nodes.filterNot { isIgnored(it) }.sortedBy { it.index }
    val hits = sorted.mapNotNull { n -> classify(n)?.let { (role, rank) -> Hit(n.index, role, rank) } }

    // A lower rank is a stronger signal, and a weaker one never beats it.
    fun best(role: Role) = hits.filter { it.role == role }.minByOrNull { it.rank }
    val strongestPassword = best(Role.PASSWORD)
    val password = strongestPassword?.index
    val newPassword = best(Role.NEW_PASSWORD)?.index
    val anchor = password ?: newPassword
    val username = if (anchor == null) {
      best(Role.USERNAME)?.index
    } else {
      // A visible or numeric password field above the real one is a login name box that switches autocorrect off.
      val before = hits
        .map { h -> if (strongestPassword != null && h.role == Role.PASSWORD && h.rank in RANK_VISIBLE_TYPE..RANK_NUMBER_TYPE && h.rank > strongestPassword.rank) Hit(h.index, Role.USERNAME_CANDIDATE, h.rank) else h }
        .filter { (it.role == Role.USERNAME || it.role == Role.USERNAME_CANDIDATE) && it.index < anchor }
      val rank = before.minOfOrNull { it.rank }
      before.lastOrNull { it.rank == rank }?.index
        ?: sorted.lastOrNull { n -> n.index < anchor && hits.none { it.index == n.index } && isPlainText(n) }?.index
    }

    val number = best(Role.CC_NUMBER)?.index
    val expMonth = best(Role.CC_MONTH)?.index
    val expYear = best(Role.CC_YEAR)?.index
    val expDate = best(Role.CC_DATE)?.index
    val cvc = best(Role.CC_CVC)?.index
    val card = if (listOfNotNull(number, expMonth, expYear, expDate, cvc).isEmpty()) null else CardFields(number, best(Role.CC_HOLDER)?.index, expMonth, expYear, expDate, cvc)
    return DetectedForm(username, password, newPassword, card)
  }

  fun allTargetsInDomain(nodes: List<FieldNode>, form: DetectedForm, requesterHost: String): Boolean {
    val host = Matching.normalizeHost(requesterHost) ?: return false
    val c = form.card
    val targets = listOfNotNull(form.username, form.password, form.newPassword, c?.number, c?.holder, c?.expMonth, c?.expYear, c?.expDate, c?.cvc)
    return targets.isNotEmpty() && targets.all { i ->
      val found = nodes.filter { it.index == i }
      found.isNotEmpty() && found.all { n -> n.webDomain?.let { Matching.normalizeHost(it) } == host }
    }
  }

  private fun classify(n: FieldNode): Pair<Role, Int>? {
    n.hints.firstNotNullOfOrNull { hintRole(it.lowercase(Locale.ROOT)) }?.let { return it to RANK_HINT }
    n.htmlAutocomplete?.lowercase(Locale.ROOT)?.split(SPACE)?.firstNotNullOfOrNull { autocompleteRole(it) }?.let { return it to RANK_AUTOCOMPLETE }
    inputTypeSignal(n)?.let { return it }
    return keywordRole(n)?.let { it to RANK_KEYWORD }
  }

  private fun hintRole(hint: String): Role? = HINT_ROLES[hint] ?: Role.OTHER.takeIf { hint.startsWith("smsotpcode") }

  private fun autocompleteRole(token: String): Role? = AUTOCOMPLETE_ROLES[token] ?: Role.OTHER.takeIf { token.startsWith("cc-") }

  private fun inputTypeSignal(n: FieldNode): Pair<Role, Int>? {
    val cls = n.inputType and CLASS_MASK
    val variation = n.inputType and VARIATION_MASK
    return when {
      n.htmlType.equals("password", ignoreCase = true) -> Role.PASSWORD to RANK_TYPE
      cls == CLASS_TEXT && variation in TEXT_PASSWORDS -> Role.PASSWORD to RANK_TYPE
      cls == CLASS_TEXT && variation == TEXT_VISIBLE_PASSWORD -> Role.PASSWORD to RANK_VISIBLE_TYPE
      cls == CLASS_NUMBER && variation == NUMBER_PASSWORD -> Role.PASSWORD to RANK_NUMBER_TYPE
      n.htmlType.equals("email", ignoreCase = true) -> Role.USERNAME_CANDIDATE to RANK_TYPE
      cls == CLASS_TEXT && variation in TEXT_EMAILS -> Role.USERNAME_CANDIDATE to RANK_TYPE
      else -> null
    }
  }

  private fun keywordRole(n: FieldNode): Role? {
    val cls = n.inputType and CLASS_MASK
    if (isSearch(n) || (cls != CLASS_TEXT && cls != CLASS_NUMBER && n.htmlType?.lowercase(Locale.ROOT) !in HTML_TYPES)) return null
    val names = listOfNotNull(n.idEntry, n.htmlName, n.hintText)
    return when {
      names.any { PASSWORD_WORD.containsMatchIn(CAMEL_HUMP.replace(it, "$1 $2").lowercase(Locale.ROOT).trim()) } -> Role.PASSWORD
      names.any { USER_WORD.containsMatchIn(it.lowercase(Locale.ROOT)) } -> Role.USERNAME_CANDIDATE
      else -> null
    }
  }

  private fun isIgnored(n: FieldNode): Boolean {
    val type = n.htmlType?.trim()?.lowercase(Locale.ROOT)
    return !type.isNullOrEmpty() && type !in HTML_TYPES
  }

  private fun isPlainText(n: FieldNode): Boolean {
    val plainInput = (n.inputType and CLASS_MASK) == CLASS_TEXT && (n.inputType and VARIATION_MASK) == 0
    return (plainInput || n.htmlType.equals("text", ignoreCase = true)) && !isSearch(n)
  }

  private fun isSearch(n: FieldNode): Boolean =
    n.htmlType.equals("search", ignoreCase = true) || listOfNotNull(n.idEntry, n.htmlName, n.hintText).any { it.contains("search", ignoreCase = true) }
}
