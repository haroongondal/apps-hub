package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiVersionTest {
  @Test fun currentIsOne() {
    assertEquals(1, ApiVersion.CURRENT)
  }
}
