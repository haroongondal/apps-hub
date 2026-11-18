package expo.modules.pdfscan.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class ImageNamesTest {
  private val t = 1_700_000_000_000L

  @Test fun differentInstantsGiveDifferentNames() {
    assertNotEquals(ImageNames.galleryName("Scan", t, 0), ImageNames.galleryName("Scan", t + 1000, 0))
  }

  @Test fun pagesSavedTogetherGetDifferentNames() {
    assertNotEquals(ImageNames.galleryName("Scan", t, 0), ImageNames.galleryName("Scan", t, 1))
  }

  @Test fun unsafeCharactersAreStripped() {
    val name = ImageNames.galleryName("a/b:c", t, 0)
    assertFalse(name, name.contains('/') || name.contains(':'))
    assertTrue(name, name.startsWith("abc-"))
  }

  @Test fun anEmptyBaseBecomesScan() {
    assertTrue(ImageNames.galleryName("", t, 0).startsWith("Scan-"))
    assertTrue(ImageNames.galleryName("::", t, 0).startsWith("Scan-"))
  }

  @Test fun formatIsBaseTimestampAndOneBasedIndex() {
    val zone = TimeZone.getDefault()
    try {
      TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
      assertEquals("PDF Editor-20231114-221320-3.jpg", ImageNames.galleryName("PDF Editor", t, 2))
    } finally {
      TimeZone.setDefault(zone)
    }
  }
}
