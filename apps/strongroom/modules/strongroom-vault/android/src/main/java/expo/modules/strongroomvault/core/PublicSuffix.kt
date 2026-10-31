package expo.modules.strongroomvault.core

import java.net.IDN
import java.util.Locale

object PublicSuffix {
  private class Rules(val normal: Set<String>, val wildcard: Set<String>, val exception: Set<String>)

  private val rules: Rules by lazy { load() }

  /** The registrable domain of a normalized (lowercase, punycode) host; null for one label or a bare public suffix. */
  fun registrableDomain(asciiHost: String): String? {
    val labels = asciiHost.split('.')
    if (labels.any { it.isEmpty() }) return null
    val n = labels.size
    val r = rules
    fun suffix(i: Int) = labels.subList(i, n).joinToString(".")
    val exceptionAt = (0 until n).firstOrNull { suffix(it) in r.exception }
    val longestMatch = (0 until n).firstOrNull { suffix(it) in r.normal || suffix(it + 1) in r.wildcard }
    val suffixLabels = when {
      exceptionAt != null -> n - exceptionAt - 1
      longestMatch != null -> n - longestMatch
      else -> 1 // the implicit "*" rule
    }
    return if (n > suffixLabels) labels.takeLast(suffixLabels + 1).joinToString(".") else null
  }

  private fun load(): Rules {
    val stream = PublicSuffix::class.java.getResourceAsStream("/public_suffix_list.dat") ?: error("public_suffix_list.dat is missing")
    val normal = HashSet<String>()
    val wildcard = HashSet<String>()
    val exception = HashSet<String>()
    stream.bufferedReader(Charsets.UTF_8).useLines { lines ->
      for (line in lines) {
        val rule = line.trim().substringBefore(' ').substringBefore('\t')
        if (rule.isEmpty() || rule.startsWith("//")) continue
        val ascii = ascii(rule.removePrefix("!").removePrefix("*.")) ?: continue
        when {
          rule.startsWith("!") -> exception.add(ascii)
          rule.startsWith("*.") -> wildcard.add(ascii)
          else -> normal.add(ascii)
        }
      }
    }
    return Rules(normal, wildcard, exception)
  }

  // A rule the platform's IDN can't convert could never match a host that normalizes through the same call.
  private fun ascii(rule: String): String? =
    if (rule.all { it.code < 128 }) {
      rule.lowercase(Locale.ROOT)
    } else {
      try {
        IDN.toASCII(rule).lowercase(Locale.ROOT)
      } catch (e: IllegalArgumentException) {
        null
      }
    }
}
