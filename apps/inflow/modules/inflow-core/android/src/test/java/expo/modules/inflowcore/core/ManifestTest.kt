package expo.modules.inflowcore.core

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

class ManifestTest {
  private val ns = "http://schemas.android.com/apk/res/android"
  private val permission = "com.haroon.permission.AUTOPILOT"
  private val root: Element = run {
    val f = File("src/main/AndroidManifest.xml")   // Gradle runs module unit tests from the module's android/ folder
    assertTrue("manifest not found from ${File(".").absoluteFile}", f.isFile)
    DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(f).documentElement
  }

  private fun Element.attr(name: String): String = getAttributeNS(ns, name)
  private fun tags(tag: String) = (0 until root.getElementsByTagName(tag).length).map { root.getElementsByTagName(tag).item(it) as Element }

  @Test fun thePermissionIsSignatureLevel() {
    val p = tags("permission").single { it.attr("name") == permission }
    assertEquals("signature", p.attr("protectionLevel"))
    assertTrue(tags("uses-permission").any { it.attr("name") == permission })
  }

  @Test fun theProviderIsExportedBehindThePermissionForReadAndWrite() {
    val p = tags("provider").single { it.attr("authorities") == "com.haroon.inflow.autopilot" }
    assertEquals("expo.modules.inflowcore.android.AutopilotProvider", p.attr("name").let { if (it.startsWith(".")) "expo.modules.inflowcore$it" else it })
    assertEquals("true", p.attr("exported"))
    assertEquals(permission, p.attr("readPermission"))
    assertEquals(permission, p.attr("writePermission"))
    assertNotEquals("true", p.attr("grantUriPermissions"))
  }

  @Test fun onlyTheKnownComponentsAreExported() {
    val exported = listOf("activity", "service", "receiver", "provider").flatMap { tags(it) }.filter { it.attr("exported") == "true" }.map { it.attr("name").substringAfterLast('.') }
    assertEquals(setOf("InflowListener", "SmsReceiver", "AutopilotProvider"), exported.toSet())
    assertEquals(3, exported.size)
  }

  @Test fun deputyIsVisibleToThePackageManager() {
    assertTrue(tags("package").any { it.attr("name") == "com.haroon.deputy" })
    assertEquals(1, tags("queries").size)
  }
}
