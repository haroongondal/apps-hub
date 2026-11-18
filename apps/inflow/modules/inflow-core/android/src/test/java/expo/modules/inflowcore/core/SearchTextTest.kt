package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchTextTest {
  @Test fun foldsHarakatAndYehKaf() {
    assertEquals(SearchText.normalize("كِتابي"), SearchText.normalize("کتابی"))
  }

  @Test fun lowercasesLatin() {
    assertEquals("bank alfalah", SearchText.normalize("Bank ALFALAH"))
  }

  @Test fun stripsTatweelAndJoiners() {
    assertEquals("پاکستان", SearchText.normalize("پـاک\u200Cستا\u200Dن"))
  }

  @Test fun likeTermsEscapesWildcards() {
    assertEquals(
      listOf("%50\\%%", "%off\\_now%", "%\\\\x%"),
      SearchText.likeTerms("50% off_now \\x"),
    )
  }

  @Test fun likeTermsCapsAtEight() {
    val terms = SearchText.likeTerms("a b c d e f g h i j")
    assertEquals(8, terms.size)
    assertEquals("%a%", terms.first())
    assertEquals("%h%", terms.last())
  }

  @Test fun likeTermsDropsBlanksAndNormalises() {
    assertTrue(SearchText.likeTerms("   \t ").isEmpty())
    assertEquals(listOf("%bank%", "%alfalah%"), SearchText.likeTerms("  Bank \n ALFALAH  "))
  }
}
