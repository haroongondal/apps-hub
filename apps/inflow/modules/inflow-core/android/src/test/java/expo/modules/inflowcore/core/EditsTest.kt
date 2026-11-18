package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EditsTest {
  @Test fun aTodoIsTrimmedAndNeverBlank() {
    assertEquals("Call Ali", Edits.todoText("  Call Ali \n"))
    assertNull(Edits.todoText("   "))
    assertNull(Edits.todoText(null))
    assertEquals(Edits.MAX_TODO, Edits.todoText("x".repeat(500))!!.length)
  }

  @Test fun aBlankCleanNameClears() {
    assertEquals("Shaafi Hospital", Edits.label(" Shaafi Hospital "))
    assertNull(Edits.label(""))
    assertNull(Edits.label(null))
    assertEquals(Edits.MAX_LABEL, Edits.label("y".repeat(300))!!.length)
  }
}
