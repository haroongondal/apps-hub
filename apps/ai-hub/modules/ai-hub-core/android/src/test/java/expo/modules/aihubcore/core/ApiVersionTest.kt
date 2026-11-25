package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiVersionTest {
  @Test fun currentIsThree() {
    assertEquals(3, ApiVersion.CURRENT)
  }
}
