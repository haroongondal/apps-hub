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
  )
  private const val CLASS_MASK = 0xf
  private const val VARIATION_MASK = 0xff0
  private const val CLASS_TEXT = 1
  private const val CLASS_NUMBER = 2
  private const val NUMBER_PASSWORD = 0x10
  private val TEXT_PASSWORDS = setOf(0x80, 0xe0, 0x90)
  private val TEXT_EMAILS = setOf(0x20, 0xd0)
  private val SPACE = Regex("\\s+")
  private val PASSWORD_WORD = Regex("pass(?!port)")
  private val USER_WORD = Regex("user|email|login")
  private val TEXTISH_HTML = setOf("text", "email", "tel", "password", "number")

  private enum class Role { USERNAME, USERNAME_CANDIDATE, PASSWORD, NEW_PASSWORD, CC_NUMBER, CC_HOLDER, CC_MONTH, CC_YEAR, CC_DATE, CC_CVC }

  // tier is the signal's priority: 0 hint, 1 html autocomplete, 2 input type, 3 keyword.
  private class Hit(val index: Int, val role: Role, val tier: Int)

  fun detect(nodes: List<FieldNode>): DetectedForm {
    val sorted = nodes.sortedBy { it.index }
    val hits = sorted.mapNotNull { n -> classify(n)?.let { (role, tier) -> Hit(n.index, role, tier) } }

    fun pick(role: Role) = hits.filter { it.role == role }.minByOrNull { it.tier }?.index
    val password = pick(Role.PASSWORD)
    val newPassword = pick(Role.NEW_PASSWORD)
    val anchor = password ?: newPassword
    val username = if (anchor == null) {
      pick(Role.USERNAME)
    } else {
      val before = hits.filter { (it.role == Role.USERNAME || it.role == Role.USERNAME_CANDIDATE) && it.index < anchor }
      val best = before.minOfOrNull { it.tier }
      before.lastOrNull { it.tier == best }?.index
        ?: sorted.lastOrNull { n -> n.index < anchor && hits.none { it.index == n.index } && isPlainText(n) }?.index
    }

    val number = pick(Role.CC_NUMBER)
    val expMonth = pick(Role.CC_MONTH)
    val expYear = pick(Role.CC_YEAR)
    val expDate = pick(Role.CC_DATE)
    val cvc = pick(Role.CC_CVC)
    val card = if (listOfNotNull(number, expMonth, expYear, expDate, cvc).isEmpty()) null else CardFields(number, pick(Role.CC_HOLDER), expMonth, expYear, expDate, cvc)
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
    n.hints.firstNotNullOfOrNull { HINT_ROLES[it.lowercase(Locale.ROOT)] }?.let { return it to 0 }
    n.htmlAutocomplete?.lowercase(Locale.ROOT)?.split(SPACE)?.firstNotNullOfOrNull { AUTOCOMPLETE_ROLES[it] }?.let { return it to 1 }
    inputTypeRole(n)?.let { return it to 2 }
    return keywordRole(n)?.let { it to 3 }
  }

  private fun inputTypeRole(n: FieldNode): Role? {
    val cls = n.inputType and CLASS_MASK
    val variation = n.inputType and VARIATION_MASK
    return when {
      n.htmlType.equals("password", ignoreCase = true) -> Role.PASSWORD
      cls == CLASS_TEXT && variation in TEXT_PASSWORDS -> Role.PASSWORD
      cls == CLASS_NUMBER && variation == NUMBER_PASSWORD -> Role.PASSWORD
      n.htmlType.equals("email", ignoreCase = true) -> Role.USERNAME_CANDIDATE
      cls == CLASS_TEXT && variation in TEXT_EMAILS -> Role.USERNAME_CANDIDATE
      else -> null
    }
  }

  private fun keywordRole(n: FieldNode): Role? {
    val cls = n.inputType and CLASS_MASK
    if (cls != CLASS_TEXT && cls != CLASS_NUMBER && n.htmlType?.lowercase(Locale.ROOT) !in TEXTISH_HTML) return null
    val words = listOfNotNull(n.idEntry, n.htmlName, n.hintText).joinToString(" ").lowercase(Locale.ROOT)
    return when {
      PASSWORD_WORD.containsMatchIn(words) -> Role.PASSWORD
      !isSearch(n) && USER_WORD.containsMatchIn(words) -> Role.USERNAME_CANDIDATE
      else -> null
    }
  }

  private fun isPlainText(n: FieldNode): Boolean {
    val plainInput = (n.inputType and CLASS_MASK) == CLASS_TEXT && (n.inputType and VARIATION_MASK) == 0
    return (plainInput || n.htmlType.equals("text", ignoreCase = true)) && !isSearch(n)
  }

  private fun isSearch(n: FieldNode): Boolean =
    n.htmlType.equals("search", ignoreCase = true) || listOfNotNull(n.idEntry, n.htmlName, n.hintText).any { it.contains("search", ignoreCase = true) }
}
