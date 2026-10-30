package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PublicSuffixTest {
  private val line = Regex("""checkPublicSuffix\((null|'[^']*'), *(null|'[^']*')\);""")

  private fun arg(s: String): String? = if (s == "null") null else s.removeSurrounding("'")

  // The input goes through the same host normalization the matcher uses; null and leading-dot inputs must give null.
  private fun registrable(input: String?): String? =
    input?.let { Matching.normalizeHost(it) }?.let { PublicSuffix.registrableDomain(it) }

  @Test fun matchesPslTestCases() {
    val text = javaClass.getResourceAsStream("/test_psl.txt")!!.use { String(it.readBytes(), Charsets.UTF_8) }
    var cases = 0
    for (l in text.lines().filter { it.startsWith("checkPublicSuffix(") }) {
      val m = requireNotNull(line.matchEntire(l.trim())) { "unparsed test line: $l" }
      val input = arg(m.groupValues[1])
      val expected = arg(m.groupValues[2])?.let { Matching.normalizeHost(it) }
      assertEquals("checkPublicSuffix($input)", expected, registrable(input))
      cases++
    }
    assertTrue("only $cases cases parsed", cases >= 78)
  }

  @Test fun vendoredListHasBothSections() {
    val text = javaClass.getResourceAsStream("/public_suffix_list.dat")!!.use { String(it.readBytes(), Charsets.UTF_8) }
    assertTrue(text.lines().first().startsWith("// Source: https://publicsuffix.org/list/public_suffix_list.dat"))
    assertTrue(text.contains("===BEGIN ICANN DOMAINS==="))
    assertTrue(text.contains("===BEGIN PRIVATE DOMAINS==="))
  }

  @Test fun privateSectionRulesApply() {
    assertEquals("a.github.io", PublicSuffix.registrableDomain("a.github.io"))
    assertEquals("a.github.io", PublicSuffix.registrableDomain("www.a.github.io"))
    assertNull(PublicSuffix.registrableDomain("github.io"))
  }

  @Test fun emptyLabelsAndEmptyInputGiveNull() {
    for (h in listOf("", ".", ".com", "example..com", "example.com.")) assertNull(h, PublicSuffix.registrableDomain(h))
    assertNotNull(PublicSuffix.registrableDomain("example.com"))
  }
}
