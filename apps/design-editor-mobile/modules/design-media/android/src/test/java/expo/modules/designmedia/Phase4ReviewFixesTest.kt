package expo.modules.designmedia

import com.arthenica.smartexception.java.Exceptions
import expo.modules.designmedia.core.PendingLog
import java.io.File
import kotlin.io.path.createTempDirectory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Found in the invariant review (2026-11-04). Each test pins one finding.
class Phase4ReviewFixesTest {
  private fun source(name: String) = File(requireNotNull(System.getProperty("module.src"))).walkTopDown().single { it.name == name }.readText()

  @Test
  fun `the class the FFmpeg AAR calls but never declares exists, with the two methods it uses`() {
    Exceptions.registerRootPackage("expo.modules.designmedia")
    assertTrue(Exceptions.getStackTraceString(IllegalStateException("boom")).contains("IllegalStateException: boom"))
    // the AAR's call sites, from javap: registerRootPackage(String) and getStackTraceString(Throwable): String
    assertEquals(String::class.java, Exceptions::class.java.getMethod("getStackTraceString", Throwable::class.java).returnType)
    Exceptions::class.java.getMethod("registerRootPackage", String::class.java)
  }

  @Test
  fun `the pending log keeps only what is still unfinished, across restarts`() {
    val file = File(createTempDirectory().toFile(), "pending.txt")
    PendingLog(file).apply { add("content://a/1"); add("content://a/2"); add("content://a/3"); remove("content://a/2") }
    assertEquals(listOf("content://a/1", "content://a/3"), PendingLog(file).all())
    PendingLog(file).apply { remove("content://a/1"); remove("content://a/3") }
    assertFalse(file.exists())
    assertEquals(emptyList<String>(), PendingLog(file).all())
  }

  @Test
  fun `start-up cleanup deletes only rows the queue inserted, never a folder`() {
    val outputs = source("Outputs.kt")
    val cleanup = outputs.substringAfter("fun deletePending(").substringBefore("\n}")
    assertTrue("cleanup must read the pending log", cleanup.contains("log.all()"))
    assertFalse("cleanup must not delete by folder (it would take the editor's own saves)", cleanup.contains("RELATIVE_PATH") || cleanup.contains("folderOf"))
    assertTrue("publish must record the row before writing and forget it when done", outputs.contains("pending.add(") && outputs.contains("pending.remove("))
  }

  @Test
  fun `a runner that fails while starting is not polled`() {
    val service = source("MediaJobService.kt")
    assertTrue(service.contains("if (!r.aborted && !r.finished) r.startPolling()"))
  }
}
