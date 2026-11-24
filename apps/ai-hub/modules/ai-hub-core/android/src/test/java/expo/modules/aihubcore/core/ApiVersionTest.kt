package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiVersionTest {
  @Test fun currentIsTwo() {
    assertEquals(2, ApiVersion.CURRENT)
  }
}
