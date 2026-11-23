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
    val exported = listOf("activity", "activity-alias", "service", "receiver", "provider").flatMap { tags(it) }.filter { it.attr("exported") == "true" }.map { it.attr("name").substringAfterLast('.') }
    assertEquals(setOf("InflowListener", "SmsReceiver", "AutopilotProvider", "HealthRationaleActivity", "ViewPermissionUsageActivity"), exported.toSet())
    assertEquals(5, exported.size)
  }

  @Test fun healthConnectIsReadOnlyWithTheRationaleScreen() {
    val health = tags("uses-permission").map { it.attr("name") }.filter { it.startsWith("android.permission.health.") }
    assertEquals(listOf("android.permission.health.READ_STEPS", "android.permission.health.READ_SLEEP", "android.permission.health.READ_HEART_RATE"), health)
    assertTrue(tags("package").any { it.attr("name") == "com.google.android.apps.healthdata" })
    val rationale = tags("activity").single { it.attr("name") == ".android.HealthRationaleActivity" }
    assertEquals("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE", (rationale.getElementsByTagName("action").item(0) as Element).attr("name"))
    val alias = tags("activity-alias").single()
    assertEquals(".android.HealthRationaleActivity", alias.attr("targetActivity"))
    assertEquals("android.permission.START_VIEW_PERMISSION_USAGE", alias.attr("permission"))
    assertEquals("android.intent.action.VIEW_PERMISSION_USAGE", (alias.getElementsByTagName("action").item(0) as Element).attr("name"))
    assertEquals("android.intent.category.HEALTH_PERMISSIONS", (alias.getElementsByTagName("category").item(0) as Element).attr("name"))
  }

  @Test fun theSuggestionComponentsAreDeclaredAndNotExported() {
    val names = listOf("activity", "receiver").flatMap { tags(it) }.associateBy { it.attr("name").substringAfterLast('.') }
    for (n in listOf("SuggestionRunActivity", "SuggestionSkipReceiver", "SuggestionReminderReceiver")) assertEquals(n, "false", names.getValue(n).attr("exported"))
  }

  @Test fun medicineRemindersAddNoPermissionAndTheirReceiversAreNotExported() {
    val names = tags("receiver").associateBy { it.attr("name").substringAfterLast('.') }
    for (n in listOf("MedicineAlarmReceiver", "MedicineActionReceiver")) assertEquals(n, "false", names.getValue(n).attr("exported"))
    val asked = tags("uses-permission").map { it.attr("name") }
    for (p in listOf("SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM", "RECEIVE_BOOT_COMPLETED", "FOREGROUND_SERVICE")) assertTrue(p, asked.none { it.endsWith(p) })
  }

  @Test fun deputyIsVisibleToThePackageManager() {
    assertTrue(tags("package").any { it.attr("name") == "com.haroon.deputy" })
    assertEquals(1, tags("queries").size)
  }
}
