package expo.modules.designmedia

import expo.modules.designmedia.core.CBR
import expo.modules.designmedia.core.FIXED
import expo.modules.designmedia.core.decodeSamples
import expo.modules.designmedia.core.firstMode
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Source scan. CBR first on the phone (2026-11-02): VBR overshot by 45%, CBR landed within 1%.
class EncoderOrderTest {
  private val service = File(requireNotNull(System.getProperty("module.src")))
    .walkTopDown().single { it.name == "MediaJobService.kt" }.readText()

  @Test
  fun aSizeJobStartsInCbrAndOtherToolsHaveNoModeToFallBackFrom() {
    assertTrue(service.contains("Run(next, next.plan, firstMode(next.plan))"))
    val plans = decodeSamples()
    assertEquals(CBR, firstMode(plans.getValue("size")))
    assertEquals(CBR, firstMode(plans.getValue("quality")))
    assertEquals(CBR, firstMode(plans.getValue("clipExact")))
    assertEquals(CBR, firstMode(plans.getValue("convertHevc")))
    listOf("clipCopy", "audioCopy", "audioAac", "gif", "convertMuted", "convertM4a", "frame", "volumeGain", "reverse", "stabilize")
      .forEach { assertEquals(it, FIXED, firstMode(plans.getValue(it))) }
  }

  @Test
  fun theVbrFallbackRunsOnlyAfterCbrFailsAndNeverInCbrOnlyMode() {
    assertTrue(service.contains("if (r.mode == CBR && !cbrOnly) {"))
    assertTrue(service.contains("r.mode = VBR"))
  }
}
