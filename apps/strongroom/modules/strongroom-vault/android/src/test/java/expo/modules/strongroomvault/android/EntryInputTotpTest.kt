package expo.modules.strongroomvault.android

import expo.modules.kotlin.exception.CodedException
import expo.modules.strongroomvault.core.Entry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** The save plumbing for a login's authenticator code (DESIGN §15.4): absent keeps, empty removes, a URI replaces. */
class EntryInputTotpTest {
  private val base = mapOf("type" to "login", "name" to "Acme", "username" to "ana", "password" to "pw", "note" to "")

  private val stored = Entry.Login(
    name = "Acme",
    username = "ana",
    password = "pw",
    sites = listOfNotNull(EntryInput.site("acme.example")),
    apps = emptyList(),
    note = "",
    updatedAt = 1,
    totp = URI,
  )

  @Test fun anAbsentKeyKeepsTheStoredCode() {
    val e = EntryInput.toEntry(base + mapOf("sites" to emptyList<String>()), stored) as Entry.Login
    assertEquals(URI, e.totp)
  }

  @Test fun anEmptyValueRemovesTheCode() {
    val e = EntryInput.toEntry(base + mapOf("sites" to emptyList<String>(), "totp" to ""), stored) as Entry.Login
    assertNull(e.totp)
  }

  @Test fun aScannedUriReplacesTheStoredCode() {
    val next = "otpauth://totp/Other:bo%40other.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
    val e = EntryInput.toEntry(base + mapOf("sites" to emptyList<String>(), "totp" to next), stored) as Entry.Login
    assertEquals(next, e.totp)
  }

  @Test fun aFirstEntryCanCarryTheCode() {
    val e = EntryInput.toEntry(base + mapOf("sites" to emptyList<String>(), "totp" to URI), null) as Entry.Login
    assertEquals(URI, e.totp)
  }

  @Test fun aBadUriIsRefused() {
    val e = assertThrows(CodedException::class.java) {
      EntryInput.toEntry(base + mapOf("sites" to emptyList<String>(), "totp" to "otpauth://totp/none?secret=short"), stored)
    }
    assertEquals("BAD_TOTP", e.code)
  }

  private companion object {
    const val URI = "otpauth://totp/Acme:ana%40acme.example?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme"
  }
}
