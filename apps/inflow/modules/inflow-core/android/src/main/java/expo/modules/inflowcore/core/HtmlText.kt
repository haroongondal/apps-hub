package expo.modules.inflowcore.core

object HtmlText {
  private val DOT = setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE)
  private val DROPPED = Regex("<!--.*?-->|<(head|style|script)\\b.*?</\\1\\s*>", DOT)
  private val BREAKS = Regex("<br\\s*/?>|</(?:p|div|tr|td|th|li|h[1-6]|table)\\s*>", RegexOption.IGNORE_CASE)
  // A bare "<" in text ("a < b") is not a tag; tags start with a letter, "/" or "!".
  private val TAG = Regex("<[a-zA-Z/!][^>]*>")
  private val ENTITY = Regex("&(nbsp|amp|lt|gt|quot|#\\d+|#[xX][0-9a-fA-F]+);")
  private val BLANKS = Regex("[ \\t]+")
  private val GAPS = Regex("\\n{3,}")

  fun toPlain(html: String): String {
    val flat = html.replace(DROPPED, " ").replace(BREAKS, "\n").replace(TAG, " ")
    return decode(flat).replace("\r\n", "\n").replace('\r', '\n')
      .lines().joinToString("\n") { it.replace(BLANKS, " ").trim() }
      .replace(GAPS, "\n\n").trim()
  }

  private fun decode(s: String): String = ENTITY.replace(s) { m ->
    when (val e = m.groupValues[1]) {
      "nbsp" -> " "
      "amp" -> "&"
      "lt" -> "<"
      "gt" -> ">"
      "quot" -> "\""
      else -> {
        val code = if (e[1] == 'x' || e[1] == 'X') e.substring(2).toIntOrNull(16) else e.substring(1).toIntOrNull()
        if (code != null && Character.isValidCodePoint(code)) String(Character.toChars(code)) else m.value
      }
    }
  }
}
