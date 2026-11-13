package expo.modules.noteboxcore.core

import java.util.Locale

private val WHITESPACE = Regex("\\s+")

// Numbers and SMS short codes share one key across apps; names stay per app.
fun senderKey(pkg: String, sender: String): String {
  val stripped = sender.filter { it != ' ' && it != '+' && it != '-' }
  if (stripped.isNotEmpty() && stripped.all { it in '0'..'9' }) {
    return "num:" + if (stripped.length > 10) stripped.takeLast(10) else stripped
  }
  return "$pkg:" + sender.lowercase(Locale.ROOT).trim().replace(WHITESPACE, " ")
}
