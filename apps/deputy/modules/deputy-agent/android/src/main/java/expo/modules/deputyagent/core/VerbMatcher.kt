package expo.modules.deputyagent.core

/**
 * Irreversible verbs from SPEC §8.2, matched as whole words in English only.
 * shortcut: icon-only buttons and other languages are missed here; extend the list when the eval finds a miss.
 */
object VerbMatcher {
  private val VERBS = listOf(
    "place order", "sign out", "log out",
    "send", "post", "publish", "reply", "share", "pay", "buy", "purchase", "order", "checkout", "confirm",
    "transfer", "withdraw", "deposit", "invest", "sell", "trade", "submit", "book", "reserve", "subscribe",
    "delete", "remove", "erase", "reset", "uninstall", "install", "call", "allow", "grant", "approve",
  ).map { it.split(' ') }

  private val CAMEL = Regex("([a-z])([A-Z])")
  private val NON_LETTERS = Regex("[^a-z]+")

  fun match(label: String?): String? {
    if (label.isNullOrBlank()) return null
    val words = label.substringAfter(":id/").replace(CAMEL, "$1 $2").lowercase().split(NON_LETTERS).filter { it.isNotEmpty() }
    return VERBS.firstOrNull { verb -> words.windowed(verb.size).any { it == verb } }?.joinToString(" ")
      // "Clear" with what it clears ("Clear chat", "Clear watch history"); alone it is a calculator's C key.
      ?: "clear".takeIf { "clear" in words.dropLast(1) }
  }

  fun match(node: NodeRef): String? = listOf(node.text, node.desc, node.childText, node.hint, node.viewId).firstNotNullOfOrNull { match(it) }
}
