package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthRequestTest {
  private val cert = "c".repeat(64)
  private val app = Requester.App(AppId("com.bank", cert), null)
  private val appWithDomain = Requester.App(AppId("com.bank", cert), "bank.com")
  private val web = Requester.Web(Site(true, "login.bank.com"))

  @Test fun extrasRoundTrip() {
    for (r in listOf(app, appWithDomain, web)) {
      for (req in listOf(AuthRequest("fill", "entry-1", r, "Bank"), AuthRequest("pick", null, r, "Bank"), AuthRequest("cards", null, r, ""))) {
        assertEquals(req, AuthRequest.parse(req.extras()::get))
      }
    }
  }

  @Test fun extrasUseOnlyStrongroomKeysAndOmitAMissingEntryId() {
    assertEquals(setOf("strongroom.mode", "strongroom.requester", "strongroom.label", "strongroom.entryId"), AuthRequest("fill", "e", web, "B").extras().keys)
    assertEquals(setOf("strongroom.mode", "strongroom.requester", "strongroom.label"), AuthRequest("pick", null, web, "B").extras().keys)
    assertEquals("pick", AuthRequest("pick", null, web, "B").extras()["strongroom.mode"])
  }

  @Test fun requesterReusesTheSavedEncoding() {
    assertEquals(web.toJson().toString(), AuthRequest("pick", null, web, "B").extras()["strongroom.requester"])
  }

  @Test fun parseReadsOnlyOwnExtras() {
    val asked = mutableListOf<String>()
    val extras = AuthRequest("fill", "entry-1", web, "Bank").extras() + mapOf(
      "android.view.autofill.extra.ASSIST_STRUCTURE" to "hostile structure",
      "android.view.autofill.extra.CLIENT_STATE" to "hostile state",
    )
    val parsed = AuthRequest.parse { key -> asked += key; extras[key] }
    assertEquals(AuthRequest("fill", "entry-1", web, "Bank"), parsed)
    assertTrue(asked.isNotEmpty())
    for (k in asked) assertTrue(k, k.startsWith("strongroom."))
  }

  @Test fun parseReadsOnlyOwnExtrasEvenWhenItRejects() {
    val asked = mutableListOf<String>()
    assertNull(AuthRequest.parse { key -> asked += key; null })
    for (k in asked) assertTrue(k, k.startsWith("strongroom."))
  }

  @Test fun parseRejectsMissingKeys() {
    val good = AuthRequest("fill", "entry-1", web, "Bank").extras()
    for (key in good.keys) assertNull(key, AuthRequest.parse((good - key)::get))
  }

  @Test fun parseRejectsBadModesAndEntryIds() {
    val good = AuthRequest("fill", "entry-1", web, "Bank").extras()
    assertNull(AuthRequest.parse((good + ("strongroom.mode" to "delete"))::get))
    assertNull(AuthRequest.parse((good + ("strongroom.mode" to "FILL"))::get))
    assertNull(AuthRequest.parse((good - "strongroom.entryId")::get))
    for (mode in listOf("pick", "cards")) {
      assertNull(mode, AuthRequest.parse((good + ("strongroom.mode" to mode))::get))
    }
  }

  @Test fun parseRejectsRequestersThatDoNotDecode() {
    val good = AuthRequest("pick", null, web, "Bank").extras()
    val hostile = listOf(
      "",
      "not json",
      "[]",
      """{"kind":"web"}""",
      """{"kind":"other","https":true,"host":"h"}""",
      """{"kind":"app","pkg":"p","certSha256":"short","domain":null}""",
      "[".repeat(200_000) + "]".repeat(200_000),
    )
    for (h in hostile) assertNull(h.take(40), AuthRequest.parse((good + ("strongroom.requester" to h))::get))
  }

  @Test fun ownPackageIsNeverServed() {
    assertFalse(shouldServe("com.haroon.strongroom", "com.haroon.strongroom"))
    assertTrue(shouldServe("com.bank", "com.haroon.strongroom"))
  }
}
