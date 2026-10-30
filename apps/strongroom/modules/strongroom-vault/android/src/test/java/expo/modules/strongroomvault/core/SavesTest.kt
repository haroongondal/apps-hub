package expo.modules.strongroomvault.core

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SavesTest {
  private val fast = KdfParams(1024, 1, 1)
  private val cert = "c".repeat(64)
  private val appId = AppId("com.bank", cert)
  private val site = Requester.Web(Site(true, "login.example.com"))
  private val store = MemoryRecordStore()
  private var wall = 1_700_000_000_000L
  private val vault = Vault(store, { wall }, { 0L })

  // Not encryption: just enough structure for openAll to tell a sealed blob from garbage.
  private val sealer = object : Sealer {
    override fun seal(plain: ByteArray) = byteArrayOf(1) + ByteArray(plain.size) { (plain[it].toInt() xor 0x5a).toByte() }

    override fun open(sealed: ByteArray): ByteArray? =
      if (sealed.isEmpty() || sealed[0] != 1.toByte()) null else ByteArray(sealed.size - 1) { (sealed[it + 1].toInt() xor 0x5a).toByte() }
  }

  private val throwingSealer = object : Sealer {
    override fun seal(plain: ByteArray): ByteArray = throw java.security.GeneralSecurityException("key gone")

    override fun open(sealed: ByteArray): ByteArray? = throw java.security.GeneralSecurityException("key gone")
  }

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
    vault.setUp("correct horse battery staple".toCharArray(), ByteArray(20) { (it + 1).toByte() }, fast)
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun pending(r: Requester = site, username: String = "me", password: String = "pw-1", at: Long = 1, label: String = "Example") =
    PendingSave(r, label, username, password, at)

  private fun logins() = vault.all().values.filterIsInstance<Entry.Login>()

  private fun item(id: String, username: String, sites: List<Site> = emptyList(), apps: List<AppLink> = emptyList()) =
    IndexItem(id, "n$id", username, sites, apps)

  @Test fun sameRequesterAndUsernameIsUpdate() {
    val index = listOf(item("x", "me", sites = listOf(Site(true, "example.com"))))
    assertEquals(SaveAction.Update("x"), Saves.decide(index, site, "me", "Example"))
  }

  @Test fun newUsernameIsCreate() {
    val index = listOf(item("x", "me", sites = listOf(Site(true, "example.com"))))
    assertEquals(SaveAction.Create("Example"), Saves.decide(index, site, "other", "Example"))
    assertEquals(SaveAction.Create("Example"), Saves.decide(emptyList(), site, "me", "Example"))
  }

  @Test fun usernamesCompareExactly() {
    val index = listOf(item("x", "Me@Example.com", sites = listOf(Site(true, "example.com"))))
    assertEquals(SaveAction.Create("L"), Saves.decide(index, site, "me@example.com", "L"))
  }

  @Test fun firstMatchingItemWins() {
    val s = listOf(Site(true, "example.com"))
    val index = listOf(item("first", "me", sites = s), item("second", "me", sites = s))
    assertEquals(SaveAction.Update("first"), Saves.decide(index, site, "me", "L"))
  }

  @Test fun applyCreatesLoginLinkedToRequester() {
    assertEquals(1, Saves.apply(vault, listOf(pending())))
    assertEquals(
      listOf(Entry.Login("Example", "me", "pw-1", listOf(Site(true, "login.example.com")), emptyList(), "", wall)),
      logins(),
    )
    val app = Requester.App(appId, "bank.com")
    assertEquals(1, Saves.apply(vault, listOf(pending(app, "me", "pw-2", label = "Bank"))))
    assertEquals(listOf(AppLink(appId, "bank.com")), logins().first { it.name == "Bank" }.apps)
  }

  @Test fun applyUpdatesTheStoredPassword() {
    val existing = Entry.Login("Mail", "me", "old", listOf(Site(true, "example.com")), emptyList(), "keep me", 1)
    val id = vault.put(null, existing)
    assertEquals(1, Saves.apply(vault, listOf(pending(password = "new"))))
    assertEquals(existing.copy(password = "new", updatedAt = wall), vault.get(id))
    assertEquals(1, logins().size)
  }

  @Test fun applyDoesNotDuplicateIdenticalSave() {
    assertEquals(1, Saves.apply(vault, listOf(pending(), pending())))
    assertEquals(0, Saves.apply(vault, listOf(pending())))
    assertEquals(1, logins().size)
  }

  @Test fun applyDoesNotRewriteAnUnchangedPassword() {
    val id = vault.put(null, Entry.Login("Mail", "me", "same", listOf(Site(true, "example.com")), emptyList(), "", 1))
    val writes = store.putAllCalls
    wall += 1000
    assertEquals(0, Saves.apply(vault, listOf(pending(password = "same"))))
    assertEquals(writes, store.putAllCalls)
    assertEquals(1_700_000_000_000L, vault.get(id)!!.updatedAt)
  }

  @Test fun applyAppliesOlderSavesFirstSoTheNewestWins() {
    assertEquals(2, Saves.apply(vault, listOf(pending(password = "newer", at = 20), pending(password = "older", at = 10))))
    assertEquals(listOf("newer"), logins().map { it.password })
  }

  @Test fun linkFromNonBrowserIsScopedToReportedDomain() {
    val base = Entry.Login("Bank", "me", "pw", emptyList(), emptyList(), "", 1)
    val linked = Saves.link(base, Requester.App(appId, "bank.com"))
    assertEquals(listOf(AppLink(appId, "bank.com")), linked.apps)
    assertTrue(Matching.matches(linked, Requester.App(appId, "bank.com")))
    assertFalse(Matching.matches(linked, Requester.App(appId, "evil.com")))
    assertFalse(Matching.matches(linked, Requester.App(appId, null)))
  }

  @Test fun linkAddsASiteAndNeverDuplicates() {
    val base = Entry.Login("Example", "me", "pw", emptyList(), emptyList(), "", 1)
    val linked = Saves.link(base, site)
    assertEquals(listOf(Site(true, "login.example.com")), linked.sites)
    assertEquals(linked, Saves.link(linked, site))
    assertEquals(linked, Saves.link(linked, Requester.Web(Site(true, "www.example.com"))))
    val http = Saves.link(linked, Requester.Web(Site(false, "example.com")))
    assertEquals(listOf(Site(true, "login.example.com"), Site(false, "example.com")), http.sites)
  }

  @Test fun saveFromNonBrowserPageDoesNotUpdateOtherSitesLogin() {
    val index = listOf(item("x", "u", apps = listOf(AppLink(appId, "bank.com"))))
    assertEquals(SaveAction.Update("x"), Saves.decide(index, Requester.App(appId, "bank.com"), "u", "L"))
    assertEquals(SaveAction.Create("L"), Saves.decide(index, Requester.App(appId, "evil.com"), "u", "L"))
    assertEquals(SaveAction.Create("L"), Saves.decide(index, Requester.App(appId, null), "u", "L"))
  }

  @Test fun pendingSaveSealFailureIsReported() {
    assertNull(Saves.seal(throwingSealer, pending()))
    assertNotNull(Saves.seal(sealer, pending()))
  }

  @Test fun pendingSavesRoundTripThroughTheSealer() {
    val saves = listOf(pending(), pending(Requester.App(appId, null), "u\u00e9", "p\"w\n", 5, "Bank"), pending(Requester.App(appId, "bank.com")))
    val (opened, lost) = Saves.openAll(sealer, saves.map { Saves.seal(sealer, it)!! })
    assertEquals(saves, opened)
    assertEquals(0, lost)
  }

  @Test fun unopenablePendingSavesAreCounted() {
    val good = Saves.seal(sealer, pending())!!
    val (opened, lost) = Saves.openAll(sealer, listOf(good, byteArrayOf(9, 9, 9)))
    assertEquals(listOf(pending()), opened)
    assertEquals(1, lost)
  }

  @Test fun openAllNeverThrowsOnHostileOrUnreadableBlobs() {
    fun sealed(json: String) = sealer.seal(json.toByteArray(Charsets.UTF_8))
    val blobs = listOf(
      sealed("{}"),
      sealed("""{"requester":{"kind":"app","pkg":"p","certSha256":"short","domain":null},"label":"l","username":"u","password":"p","at":1}"""),
      sealed("""{"requester":{"kind":"mystery"},"label":"l","username":"u","password":"p","at":1}"""),
      sealed("[".repeat(200_000) + "]".repeat(200_000)),
      ByteArray(0),
    )
    assertEquals(Pair(emptyList<PendingSave>(), blobs.size), Saves.openAll(sealer, blobs))
    assertEquals(Pair(emptyList<PendingSave>(), 2), Saves.openAll(throwingSealer, listOf(byteArrayOf(1), byteArrayOf(2))))
  }

  @Test fun pendingSaveNeverPrintsItsPassword() {
    assertFalse(pending(password = "hunter2-unique").toString().contains("hunter2-unique"))
    assertTrue(pending().toString().contains("password=***"))
  }
}
