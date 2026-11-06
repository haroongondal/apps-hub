package expo.modules.designmedia.core

import kotlin.math.abs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RetryRuleTest {
  private val cases = Json.parseToJsonElement(fixtureText("retry-cases.json")).jsonObject.getValue("cases").jsonArray

  @Test
  fun everyRetryCaseFromTheSharedFixturePasses() {
    for (element in cases) {
      val case = element.jsonObject
      val name = case.getValue("name").jsonPrimitive.content
      val expect = case.getValue("expect").jsonObject
      val plan = decodeSizePlan(case.getValue("plan").jsonObject)
      val got = nextSizeAttempt(plan, case.getValue("actualBytes").jsonPrimitive.long)
      assertEquals(name, expect.getValue("ok").jsonPrimitive.boolean, got !is Next.GaveUp)
      val next = when (got) {
        is Next.Publish -> got.plan
        is Next.Retry -> got.plan
        is Next.GaveUp -> {
          assertEquals(name, expect.getValue("reason").jsonPrimitive.content, "gave-up")
          continue
        }
      }
      expect["attempt"]?.let { assertEquals(name, it.jsonPrimitive.int, next.attempt) }
      expect["rung"]?.jsonObject?.let {
        assertEquals(name, Rung(it.getValue("shortSide").jsonPrimitive.int, it.getValue("fps").jsonPrimitive.int), next.rung)
      }
      expect["videoBps"]?.let { assertEquals(name, it.jsonPrimitive.int, next.videoBps) }
      expect["videoBpsApprox"]?.let {
        val approx = it.jsonPrimitive.double
        assertTrue("$name: ${next.videoBps} is not within 0.1% of $approx", abs(next.videoBps - approx) / approx < 0.001)
      }
    }
  }

  @Test
  fun ladderReproducesTheBudgetRows() {
    assertEquals(Rung(720, 30), walkLadder(1920, 1080, 30, 2236595, "hw-h264").rung)
    assertEquals(Rung(1080, 30), walkLadder(1920, 1080, 30, 2236595, "hw-hevc").rung)
    val threeMinute = walkLadder(1920, 1080, 30, 692198, "hw-h264")
    assertEquals(Triple(Rung(480, 30), 854, 480), Triple(threeMinute.rung, threeMinute.width, threeMinute.height))
    assertEquals(Rung(540, 30), walkLadder(1920, 1080, 30, 692198, "hw-hevc").rung)
    assertEquals(Rung(1080, 30), walkLadder(1920, 1080, 30, 6263262, "x264").rung)
  }
}
