package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CallerPolicyTest {
  private val hub = "com.haroon.aihub"

  private fun decide(pkg: String, signed: Boolean = true, switches: Map<String, Boolean> = emptyMap()) =
    CallerPolicy.decide(pkg, signed, switches, hub)

  @Test fun strongroomDeniedEvenWhenSwitchedOn() {
    val d = decide("com.haroon.strongroom", switches = mapOf("com.haroon.strongroom" to true))
    assertTrue(d is Decision.Deny)
  }

  @Test fun differentSignatureDenied() {
    assertTrue(decide("com.haroon.nexus", signed = false) is Decision.Deny)
  }

  @Test fun switchedOffDenied() {
    assertTrue(decide("com.haroon.nexus", switches = mapOf("com.haroon.nexus" to false)) is Decision.Deny)
  }

  @Test fun unknownAppDefaultsOn() {
    assertEquals(Decision.Allow, decide("com.haroon.nexus"))
  }

  @Test fun hubAllowed() {
    assertEquals(Decision.Allow, decide(hub))
  }
}
