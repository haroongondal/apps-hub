package expo.modules.deputyagent.applink

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLinkTargetTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private fun fixture(name: String): String {
    val f = File("../../../../../packages/app-link-contract/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return f.readText()
  }

  // The fixtures are flat JSON (strings, null, booleans), so a regex reads them without a JSON library.
  private val field = Regex("\"([\\w-]+)\"\\s*:\\s*(\"((?:[^\"\\\\]|\\\\.)*)\"|null|true|false)")

  private fun flat(text: String): Map<String, Any?> = field.findAll(text).associate { m ->
    m.groupValues[1] to when (m.groupValues[2]) {
      "null" -> null
      "true" -> true
      "false" -> false
      else -> m.groupValues[3]
    }
  }

  private fun rows(text: String) = Regex("\\{[^{}]*\\}").findAll(text).map { flat(it.value) }.toList()

  private fun expected(trust: Any?, reason: Any?): AppLinkTarget.Decision = when (trust) {
    "trusted" -> AppLinkTarget.Decision.Trusted
    "not-installed" -> AppLinkTarget.Decision.NotInstalled
    "spoofed" -> AppLinkTarget.Decision.Spoofed(AppLinkTarget.Reason.valueOf((reason as String).uppercase().replace('-', '_')))
    else -> throw AssertionError("unknown trust $trust")
  }

  @Test fun decideEqualsEveryFixtureRow() {
    val cases = rows(fixture("target-decisions.json"))
    assertTrue(cases.size >= 12)
    for (c in cases) {
      val d = AppLinkTarget.decide(c["expectedPackage"] as String, c["resolvedPackage"] as String?, c["signaturesMatch"] as Boolean)
      assertEquals("${c["case"]}", expected(c["trust"], c["reason"]), d)
    }
  }

  @Test fun siblingPackagesEqualTheSharedFixture() = assertEquals(flat(fixture("sibling-packages.json")), SiblingPackages.ALL)

  @Test fun thePermissionIsTheLinkPermission() = assertEquals("com.haroon.permission.AUTOPILOT", AppLinkTarget.LINK_PERMISSION)
}
