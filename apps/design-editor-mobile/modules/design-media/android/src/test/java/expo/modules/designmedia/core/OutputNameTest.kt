package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Test

// Same cases as packages/media-core/src/__tests__/names.test.ts.
class OutputNameTest {
  private val none: (String) -> Boolean = { false }

  @Test
  fun sizeOutputsAreCompressedMp4() {
    assertEquals("Trip (compressed).mp4", outputName("Trip.mov", none))
  }

  @Test
  fun aTakenNameGetsTwoThenThree() {
    val taken = setOf("Trip (compressed).mp4", "Trip (compressed) 2.mp4")
    assertEquals("Trip (compressed) 3.mp4", outputName("Trip.mp4") { it in taken })
  }

  @Test
  fun pathSeparatorsAndControlCharactersAreReplaced() {
    assertEquals("a_b_c_d_ (compressed).mp4", outputName("a/b:c*d?.mp4", none))
  }

  @Test
  fun aNameWithoutAnExtensionKeepsAllOfIt() {
    assertEquals("Holiday (compressed).mp4", outputName("Holiday", none))
  }

  @Test
  fun aDotfileKeepsItsDot() {
    assertEquals(".clip (compressed).mp4", outputName(".clip", none))
  }
}
