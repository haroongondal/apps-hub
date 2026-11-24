package expo.modules.audiochunks.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CutWindowTest {
  @Test
  fun convertsMillisecondsToMicroseconds() {
    val w = CutWindow(1_798_000.0, 3_600_000.5)
    assertEquals(1_798_000_000L, w.startUs)
    assertEquals(3_600_000_500L, w.endUs)
  }

  @Test
  fun keepsSamplesBeforeTheEndOnly() {
    val w = CutWindow(1_000.0, 2_000.0)
    assertTrue(w.keeps(999_000))
    assertTrue(w.keeps(1_999_999))
    assertFalse(w.keeps(2_000_000))
    assertFalse(w.keeps(-1))
  }

  @Test
  fun shiftsTimesToStartAtZero() {
    val w = CutWindow(1_000.0, 2_000.0)
    assertEquals(0L, w.shifted(998_000, 998_000))
    assertEquals(23_220L, w.shifted(1_021_220, 998_000))
  }

  @Test
  fun refusesEmptyOrNegativeWindows() {
    assertThrows(IllegalArgumentException::class.java) { CutWindow(-1.0, 10.0) }
    assertThrows(IllegalArgumentException::class.java) { CutWindow(10.0, 10.0) }
    assertThrows(IllegalArgumentException::class.java) { CutWindow(20.0, 10.0) }
  }

  @Test
  fun readsFileUrisAndPlainPaths() {
    assertEquals("/data/user/0/app/files/library/a b/audio.m4a", filePath("file:///data/user/0/app/files/library/a%20b/audio.m4a"))
    assertEquals("/cache/piece-1.m4a", filePath("/cache/piece-1.m4a"))
    assertThrows(IllegalArgumentException::class.java) { filePath("content://media/1") }
  }
}
