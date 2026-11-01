package expo.modules.strongroomvault.android

import android.text.InputType.TYPE_CLASS_NUMBER
import android.text.InputType.TYPE_CLASS_TEXT
import android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
import android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
import android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
import android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
import android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecretFieldTest {
  private val text = TYPE_CLASS_TEXT or TYPE_TEXT_FLAG_NO_SUGGESTIONS

  @Test fun hiddenTextIsAPassword() = assertEquals(text or TYPE_TEXT_VARIATION_PASSWORD, secretInputType(shown = false, numeric = false, multiline = false))

  @Test fun shownTextIsAVisiblePassword() =
    assertEquals(text or TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, secretInputType(shown = true, numeric = false, multiline = false))

  @Test fun noteIsAMultilineVisiblePassword() =
    assertEquals(text or TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or TYPE_TEXT_FLAG_MULTI_LINE, secretInputType(shown = true, numeric = false, multiline = true))

  @Test fun hiddenNumberIsANumberPassword() =
    assertEquals(TYPE_CLASS_NUMBER or TYPE_NUMBER_VARIATION_PASSWORD, secretInputType(shown = false, numeric = true, multiline = false))

  @Test fun shownNumberIsPlainDigits() = assertEquals(TYPE_CLASS_NUMBER, secretInputType(shown = true, numeric = true, multiline = false))

  @Test fun staleValueIsSkipped() = assertFalse(shouldApplyValue(jsEventCount = 2, eventCount = 3, current = "abc", value = "ab"))

  @Test fun equalValueIsANoOp() = assertFalse(shouldApplyValue(jsEventCount = 3, eventCount = 3, current = "abc", value = "abc"))

  @Test fun programmaticValueWithACurrentCountIsApplied() = assertTrue(shouldApplyValue(jsEventCount = 3, eventCount = 3, current = "abc", value = "xyz"))

  @Test fun valueIntoAnEmptyFieldIsApplied() = assertTrue(shouldApplyValue(jsEventCount = 0, eventCount = 0, current = null, value = "xyz"))

  @Test fun valueAheadOfTheCountIsApplied() = assertTrue(shouldApplyValue(jsEventCount = 5, eventCount = 3, current = "abc", value = "xyz"))
}
