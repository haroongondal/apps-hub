package expo.modules.designmedia

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

// Source scan. CBR first on the phone (2026-11-02): VBR overshot by 45%, CBR landed within 1%.
class EncoderOrderTest {
  private val service = File(requireNotNull(System.getProperty("module.src")))
    .walkTopDown().single { it.name == "MediaJobService.kt" }.readText()

  @Test
  fun aSizeJobStartsInCbr() {
    assertTrue(service.contains("Run(next, next.plan, CBR)"))
  }

  @Test
  fun theVbrFallbackRunsOnlyAfterCbrFailsAndNeverInCbrOnlyMode() {
    assertTrue(service.contains("if (r.mode == CBR && !cbrOnly) {"))
    assertTrue(service.contains("r.mode = VBR"))
  }
}
