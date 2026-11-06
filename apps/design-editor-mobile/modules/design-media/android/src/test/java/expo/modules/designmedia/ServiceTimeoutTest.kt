package expo.modules.designmedia

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

// Source scan. Found on the phone 2026-11-02: onTimeout returned while still foreground, and the app crashed.
class ServiceTimeoutTest {
  @Test
  fun `onTimeout calls stopForeground before stopSelf`() {
    val service = File(requireNotNull(System.getProperty("module.src")))
      .walkTopDown().single { it.name == "MediaJobService.kt" }.readText()
    val body = service.substringAfter("override fun onTimeout(").substringBefore("override fun onDestroy")
    val remove = body.indexOf("stopForeground(STOP_FOREGROUND_REMOVE)")
    val stop = body.indexOf("stopSelf()")
    assertTrue("onTimeout must call stopForeground(STOP_FOREGROUND_REMOVE)", remove >= 0)
    assertTrue("stopSelf must follow stopForeground in onTimeout", stop > remove)
  }
}
