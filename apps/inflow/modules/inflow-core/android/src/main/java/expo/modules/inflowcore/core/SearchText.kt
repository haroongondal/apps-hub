package expo.modules.inflowcore.core

import java.text.Normalizer
import java.util.Locale

object SearchText {
  private const val MAX_TERMS = 8

  private val STRIPPED = Regex("[\u064B-\u065F\u0670\u0640\u200C\u200D]")

  // Mirrors packages/library-core/src/normalize.ts (harakat, tatweel, ZWNJ/ZWJ, yeh and kaf), then lowercases.
  fun normalize(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFKC)
      .replace(STRIPPED, "")
      .replace('\u064A', '\u06CC')
      .replace('\u0643', '\u06A9')
      .lowercase(Locale.ROOT)

  fun likeTerms(query: String): List<String> =
    normalize(query)
      .split(Regex("\\s+"))
      .filter { it.isNotEmpty() }
      .take(MAX_TERMS)
      .map { "%" + it.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" }
}
