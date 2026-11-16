package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenPlanTest {
  @Test fun noDbAndNoKeyCreatesNew() {
    assertEquals(OpenPlan.CreateNew, openPlan(dbExists = false, wrappedKeyPresent = false))
  }

  @Test fun dbAndKeyOpens() {
    assertEquals(OpenPlan.Open, openPlan(dbExists = true, wrappedKeyPresent = true))
  }

  @Test fun keyWithoutDbCreatesNew() {
    assertEquals(OpenPlan.CreateNew, openPlan(dbExists = false, wrappedKeyPresent = true))
  }

  @Test fun dbWithoutKeyFailsAndSaysTheFileIsKept() {
    val plan = openPlan(dbExists = true, wrappedKeyPresent = false)
    assertTrue(plan is OpenPlan.Fail)
    assertTrue((plan as OpenPlan.Fail).message.contains("kept"))
  }
}
