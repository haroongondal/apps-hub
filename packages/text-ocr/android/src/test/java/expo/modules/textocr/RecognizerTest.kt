package expo.modules.textocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RecognizerTest {
  @Test fun smallPictureIsNotSampled() = assertEquals(1, sampleSizeFor(1200, 800))

  @Test fun picturesAtTheLimitAreNotSampled() = assertEquals(1, sampleSizeFor(3000, 2000))

  @Test fun twelveMegapixelPhotoHalvesToUnderTheLimit() = assertEquals(2, sampleSizeFor(4000, 3000))

  @Test fun tallScanIsSampledOnItsLongSide() = assertEquals(4, sampleSizeFor(2000, 9000))

  @Test fun keepsConfidentText() = assertTrue(keepLine("Hello", 90f))

  @Test fun keepsLineAtTheThreshold() = assertTrue(keepLine("Hello", MIN_LINE_CONFIDENCE.toFloat()))

  @Test fun dropsLowConfidence() = assertFalse(keepLine("xq7", 12f))

  @Test fun dropsEmptyAndBlankText() {
    assertFalse(keepLine(null, 99f))
    assertFalse(keepLine("  \n", 99f))
  }

  @Test fun noLanguageMeansEnglish() = assertEquals(listOf("eng"), languageCodes(null))

  @Test fun languagesKeepTheirOrder() {
    assertEquals(listOf("ara", "eng"), languageCodes("ara+eng"))
    assertEquals(listOf("urd"), languageCodes("urd"))
  }

  @Test fun unknownOrRepeatedLanguagesAreRefused() {
    for (bad in listOf("", "fra", "eng+", "+eng", "eng+eng", "../eng", "eng+../ara", "ENG", "ara eng"))
      assertThrows(bad, IllegalArgumentException::class.java) { languageCodes(bad) }
  }
}
