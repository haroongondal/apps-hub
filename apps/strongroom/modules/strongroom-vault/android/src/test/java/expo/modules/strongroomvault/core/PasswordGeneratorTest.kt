package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PasswordGeneratorTest {
  @Test fun is20CharsWithEveryClassAndNoLookAlikes() {
    repeat(200) {
      val p = PasswordGenerator.generate()
      assertEquals(p, 20, p.length)
      assertTrue(p, p.any { it in 'A'..'Z' } && p.any { it in 'a'..'z' } && p.any { it in '0'..'9' } && p.any { it in "!@#%-_" })
      assertTrue(p, p.none { it in "lIO01" })
    }
  }

  @Test fun differsEachTime() = assertNotEquals(PasswordGenerator.generate(), PasswordGenerator.generate())
}
