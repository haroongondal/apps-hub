package expo.modules.strongroomvault.core

import java.lang.reflect.Modifier
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PasswordHealthTest {
  private fun login(password: String, name: String = "Example", username: String = "sam", site: String = "example.org") =
    Entry.Login(name, username, password, listOf(Site(true, site)), emptyList(), "", 1)

  private val common = CommonPasswords.set

  @Test fun everyFixtureCaseGetsItsFlags() {
    val cases = Json.parseToJsonElement(javaClass.getResourceAsStream("/password-health-cases.json")!!.readBytes().decodeToString()).jsonArray
    assertEquals(10, cases.size)
    for (c in cases.map { it.jsonObject }) {
      val s = { k: String -> c.getValue(k).jsonPrimitive.content }
      val got = PasswordHealth.flags(login(s("password"), s("name"), s("username"), s("site")), common).map { it.id }.toSet()
      assertEquals(s("why"), c.getValue("flags").jsonArray.map { it.jsonPrimitive.content }.toSet(), got)
    }
  }

  @Test fun weakPatternsNeedToCoverHalfThePassword() {
    assertEquals(setOf(HealthFlag.KEYBOARD_RUN), PasswordHealth.flags(login("asdfghjkl;Zx9!"), emptySet()) - HealthFlag.TOO_SHORT)
    assertEquals(emptySet<HealthFlag>(), PasswordHealth.flags(login("Wv7!qRz2-1234-pXmT8&kL"), emptySet()))
    assertEquals(emptySet<HealthFlag>(), PasswordHealth.flags(login("Wv7!qRz2-aaa-pXmT8&kL"), emptySet()))
    assertTrue(HealthFlag.KEYBOARD_RUN in PasswordHealth.flags(login("9876543210zyxw"), emptySet()))
  }

  @Test fun tooShortDependsOnLengthAndKinds() {
    assertTrue(PasswordHealth.bits("abcdefghij") < PasswordHealth.MIN_BITS)
    assertTrue(PasswordHealth.bits("Ab3!Ab3!") > PasswordHealth.MIN_BITS)
    assertEquals(0.0, PasswordHealth.bits(""), 0.0)
  }

  @Test fun theBundledListIsTheSecListsTenThousandLowercased() {
    assertTrue(common.size >= 10_000)
    assertTrue("password" in common && "123456" in common && "qwerty" in common)
    assertTrue(common.all { it == it.lowercase() && it.isNotEmpty() && !it.startsWith("//") })
    val head = javaClass.getResourceAsStream("/common_passwords.txt")!!.bufferedReader().use { it.readLine() + it.readLine() }
    assertTrue(head.contains("SecLists") && head.contains("MIT"))
  }

  @Test fun commonIsCaseBlindAndSeesAFewCharactersAdded() {
    val list = setOf("dragon", "letmein")
    assertTrue(PasswordHealth.isCommon("dragon", list))
    assertTrue(HealthFlag.COMMON in PasswordHealth.flags(login("DRAGON"), list))
    assertTrue(PasswordHealth.isCommon("letmein99!", list))
    assertFalse(PasswordHealth.isCommon("letmein12345", list))
    assertFalse(PasswordHealth.isCommon("dragonfly", list))
  }

  @Test fun reusedPasswordsFormGroupsBiggestFirst() {
    val shared = "Same-Pass-word!93x"
    val pair = "Other-Shared#Pw-71q"
    val entries = mapOf(
      "a" to login(shared), "b" to login(shared, "Two"), "c" to login(shared, "Three"),
      "d" to login(pair), "e" to login(pair, "Five"),
      "f" to login("Unique-Strong%Pw-28z"), "g" to login("same-pass-word!93x"),
      "h" to login(""), "n" to Entry.Note("Note", shared, 1), "x" to Entry.Deleted(1),
    )
    val report = PasswordHealth.check(entries, emptySet())
    assertEquals(7, report.checked)
    assertEquals(mapOf("a" to 1, "b" to 1, "c" to 1, "d" to 2, "e" to 2), report.items.associate { it.id to it.reuseGroup })
    assertTrue(report.items.all { it.flags == setOf(HealthFlag.REUSED) })
    assertEquals(5, report.reused)
    assertEquals(0, report.weak)
  }

  @Test fun theResultCannotCarryAPassword() {
    fun fields(c: Class<*>) = c.declaredFields.filterNot { Modifier.isStatic(it.modifiers) }.associate { it.name to it.type }
    assertEquals(mapOf("checked" to Int::class.java, "items" to List::class.java), fields(HealthReport::class.java))
    assertEquals(mapOf("id" to String::class.java, "flags" to Set::class.java, "reuseGroup" to Int::class.java), fields(HealthItem::class.java))
    assertTrue(HealthFlag::class.java.isEnum)

    val secret = "Unique-Strong%Pw-28z"
    val report = PasswordHealth.check(mapOf("a" to login(secret), "b" to login(secret), "c" to login("123456")), CommonPasswords.set)
    assertFalse(report.toString().contains(secret))
    assertFalse(report.toString().contains("123456"))
  }
}
