package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Test

class ArtSampleTest {
  @Test fun sampleSize_keeps_side_at_least_target() {
    assertEquals(8, sampleSize(1024, 1024, 96))
    assertEquals(1, sampleSize(80, 80, 96))
    assertEquals(32, sampleSize(4000, 3000, 96))
  }
}
