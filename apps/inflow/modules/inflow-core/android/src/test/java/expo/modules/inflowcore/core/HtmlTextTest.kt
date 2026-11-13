package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Test

class HtmlTextTest {
  @Test fun tableCellsStaySeparate() {
    assertEquals("Amount\nPKR 1,700.00/-", HtmlText.toPlain("<tr><td>Amount</td><td>PKR&nbsp;1,700.00/-</td></tr>"))
  }

  @Test fun styleDroppedAndBreaksKept() {
    assertEquals("a\nb", HtmlText.toPlain("<style>p{}</style><p>a<br>b</p>"))
  }

  @Test fun entitiesDecodedOnce() {
    assertEquals("&'A", HtmlText.toPlain("&amp;&#39;&#x41;"))
    assertEquals("&lt;", HtmlText.toPlain("&amp;lt;"))
  }

  @Test fun inlineTagsKeepTheSpace() {
    assertEquals("PKR 5", HtmlText.toPlain("<b>PKR</b> <span>5</span>"))
  }

  @Test fun headScriptAndCommentsDropped() {
    assertEquals("hi", HtmlText.toPlain("<html><head><title>t</title></head><body><!-- x --><script>var a=1;</script>hi</body></html>"))
  }

  @Test fun inlineTagsWithoutSpaceBecomeASpace() {
    assertEquals("a b", HtmlText.toPlain("a<i>b</i>"))
  }

  @Test fun rawNoBreakSpaceBecomesASpace() {
    assertEquals("Amount\nPKR 1,700.00/-", HtmlText.toPlain("<tr><td>Amount</td><td>PKR\u00A01,700.00/-</td></tr>"))
    val html = "<p>" + Samples.ALFALAH_EMAIL.replace("PKR 1,700.00/-", "PKR\u00A01,700.00/-") + "</p>"
    assertEquals(170000L, BankParser.parse(HtmlText.toPlain(html))?.amountMinor)
  }
}
