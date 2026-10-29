package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class SavedTaskTest {
  private val alarm = SavedTask("a1", "Next alarm", "Open the clock app and tell me my next alarm", emptyList())
  private val chat = SavedTask("c1", "Message me", "Send 'hi' to myself on WhatsApp", listOf("com.whatsapp"))

  @Test fun aListSurvivesTheStoredJson() {
    assertEquals(listOf(alarm, chat), SavedTask.fromJson(SavedTask.toJson(listOf(alarm, chat))))
  }

  @Test fun noListedAppsMeansNoAppLimit() {
    assertNull(SavedTask.allowList(null))
    assertNull(SavedTask.allowList(alarm.apps))
    assertEquals(setOf("com.whatsapp"), SavedTask.allowList(listOf("com.whatsapp", "com.whatsapp")))
  }

  @Test fun needsANameAndATask() {
    assertThrows(IllegalArgumentException::class.java) { alarm.copy(name = " ") }
    assertThrows(IllegalArgumentException::class.java) { alarm.copy(name = "x".repeat(61)) }
    assertThrows(IllegalArgumentException::class.java) { alarm.copy(task = "") }
  }

  @Test fun unreadableStoredTasksAreSkipped() {
    assertEquals(emptyList<SavedTask>(), SavedTask.fromJson("{oops"))
    assertEquals(listOf(alarm), SavedTask.fromJson("""[{"id":"x","name":"","task":"t","apps":[]},${SavedTask.toJson(listOf(alarm)).removeSurrounding("[", "]")}]"""))
  }
}
