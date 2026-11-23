package expo.modules.haloengine.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ChangedReceiverTest {
  private val source = File("src/main/java/expo/modules/haloengine/android/ChangedReceiver.kt").readText()

  @Test fun theReceiverReadsNoExtrasAndNoData() {
    val code = source.lines().filterNot { it.trimStart().startsWith("//") }.joinToString("\n")
    for (word in listOf("Extra", "extras", "getData", ".data", "dataString", "clipData", "getBundle", "resultData")) {
      assertFalse("ChangedReceiver touches $word", word in code)
    }
  }

  @Test fun itListensForThePingOnlyAndHandsOverToTheReader() {
    assertEquals("com.haroon.autopilot.CHANGED", ChangedReceiver.ACTION)
    val body = source.substringAfter("override fun onReceive(").substringBefore("companion object")
    assertEquals("if (intent.action == ACTION) Links.ping(context)", body.lines()[1].trim())
  }
}
