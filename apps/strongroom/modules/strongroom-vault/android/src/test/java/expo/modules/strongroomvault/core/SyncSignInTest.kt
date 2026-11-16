package expo.modules.strongroomvault.core

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class SyncSignInTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "a master password".toCharArray()
  private val newPassword = "new master password".toCharArray()
  private val rid = id(1)

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun fake(kdf: KdfParams, accountKey: Boolean = true) = Header(1, kdf, ByteArray(16), ByteArray(60), ByteArray(60), accountKey)

  private fun rows(l: List<SyncRow>) = l.map { Triple(it.id, it.sealed.toList(), it.rev) }

  private inner class Account(accountKey: ByteArray? = null) {
    val recoveryKey = RecoveryKey.generate()
    private val created = VaultFormat.create(password, recoveryKey, fast, accountKey)
    val header = created.first
    val vaultKey = created.second
    val keys = VaultFormat.openWithPassword(header, password, accountKey)!!
    val sealed = VaultFormat.sealEntry(vaultKey, rid, Entry.Note("n", "t", 1))
    private val hashes = setOf(Crypto.tokenHash(keys.loginToken), Crypto.tokenHash(VaultFormat.recoveryLoginToken(recoveryKey)))
    val prelogin = Prelogin(header.kdf, b64(header.salt), header.accountKey)
    var page = PullResponse(header.toJson(), 4, listOf(WireRecord(rid, 7, b64(sealed))), 9, false)
    var pulls = 0

    val t = object : SyncTransport {
      override fun prelogin() = prelogin

      override fun pull(token: ByteArray, since: Long): PullResponse {
        pulls++
        if (Crypto.tokenHash(token) !in hashes) throw SyncAuthError()
        return page
      }

      override fun push(token: ByteArray, req: PushRequest): PushResult = error("sign-in never pushes")

      override fun putAccount(setupToken: String, body: AccountCreate): Long = error("sign-in never writes the account")

      override fun putAccount(token: ByteArray, body: AccountUpdate): Long = error("sign-in never writes the account")

      override fun lostRequest(claimHash: String) = error("not used")

      override fun lostRelease(claim: String): LostRelease = error("not used")

      override fun lostStatus(token: ByteArray): LostStatus = error("not used")

      override fun lostCancel(token: ByteArray) = error("not used")

      override fun deleteEscrow(token: ByteArray) = error("not used")
    }

    fun withPrelogin(kdf: KdfParams) = object : SyncTransport by t {
      override fun prelogin() = prelogin.copy(kdf = kdf)
    }
  }

  @Test fun refusesWeakerHeader() {
    val key = Crypto.randomBytes(20)
    val (remote, vaultKey) = VaultFormat.create(password, RecoveryKey.generate(), fast, key)
    assertEquals(remote, SyncClient.adoptHeader(fake(fast), remote, password, key, vaultKey))
    for (held in listOf(fast.copy(memoryKiB = 2048), fast.copy(iterations = 2), fast.copy(parallelism = 2))) {
      assertNull(held.toString(), SyncClient.adoptHeader(fake(held), remote, password, key, vaultKey))
    }
    for (kdf in listOf(fast.copy(memoryKiB = 2 * 1048576), fast.copy(iterations = 17), fast.copy(parallelism = 5), fast.copy(memoryKiB = 512))) {
      assertNull(kdf.toString(), SyncClient.adoptHeader(fake(fast), remote.copy(kdf = kdf), password, key, vaultKey))
    }
    KdfParams.testFloor = null
    assertNull("below the production floor", SyncClient.adoptHeader(fake(fast), remote, password, key, vaultKey))
  }

  @Test fun refusesDroppedAccountKeyFlag() {
    val key = Crypto.randomBytes(20)
    val (h, vaultKey) = VaultFormat.create(password, RecoveryKey.generate(), fast, key)
    val stripped = h.copy(accountKey = false)
    assertNull(SyncClient.adoptHeader(h, stripped, password, key, vaultKey))
    assertNull(SyncClient.adoptHeader(stripped, stripped, password, key, vaultKey))
  }

  @Test fun adoptsHeaderOnlyWithNewPasswordAndSameVaultKey() {
    val key = Crypto.randomBytes(20)
    val (local, vaultKey) = VaultFormat.create(password, RecoveryKey.generate(), fast, key)
    val changed = VaultFormat.withNewPassword(local, vaultKey, newPassword, accountKey = key)
    assertEquals(changed, SyncClient.adoptHeader(local, changed, newPassword, key, vaultKey))
    assertNull(SyncClient.adoptHeader(local, changed, password, key, vaultKey))
    assertNull(SyncClient.adoptHeader(local, changed, newPassword, Crypto.randomBytes(20), vaultKey))
    assertThrows(AccountKeyRequired::class.java) { SyncClient.adoptHeader(local.copy(accountKey = false), changed, newPassword, null, vaultKey) }
    val other = VaultFormat.create(newPassword, RecoveryKey.generate(), fast, key).first
    assertNull(SyncClient.adoptHeader(local, other, newPassword, key, vaultKey))
  }

  // Deriving at or past the ceiling would blow the timeout, so passing proves nothing was derived.
  @Test(timeout = 5000)
  fun signInChecksKdfBeforeDeriving() {
    val a = Account(Crypto.randomBytes(20))
    val ceiling = KdfParams(KdfParams.MAX_MEMORY_KIB, KdfParams.MAX_ITERATIONS, KdfParams.MAX_PARALLELISM)
    assertThrows(AccountKeyRequired::class.java) { SyncClient.signInWithPassword(a.t, password) }
    assertThrows(AccountKeyRequired::class.java) { SyncClient.signInWithPassword(a.withPrelogin(ceiling), password) }
    KdfParams.testFloor = null
    for (kdf in listOf(KdfParams(1024, 3, 1), KdfParams(Int.MAX_VALUE, 1, 1), ceiling.copy(iterations = 17))) {
      val e = assertThrows(KdfOutOfRange::class.java) { SyncClient.signInWithPassword(a.withPrelogin(kdf), password, Crypto.randomBytes(20)) }
      assertEquals(kdf, e.kdf)
    }
    assertEquals(0, a.pulls)
  }

  @Test fun signInWithWrongAccountKeyFails() {
    val key = Crypto.randomBytes(20)
    val a = Account(key)
    assertThrows(SyncAuthError::class.java) { SyncClient.signInWithPassword(a.t, password, Crypto.randomBytes(20)) }
    assertThrows(SyncAuthError::class.java) { SyncClient.signInWithPassword(a.t, "not the password".toCharArray(), key) }
  }

  @Test fun signInWithPasswordOpensTheVault() {
    val key = Crypto.randomBytes(20)
    val a = Account(key)
    val s = SyncClient.signInWithPassword(a.t, password, key)
    assertEquals(a.header, s.header)
    assertEquals(listOf<Any>(4L, 9L, 0), listOf(s.headerRev, s.lastRev, s.skipped))
    assertEquals(listOf(Triple(rid, a.sealed.toList(), 7L)), rows(s.records))
    assertEquals(emptyList<Any>(), s.quarantine)
    assertArrayEquals(a.vaultKey, s.vaultKey)
    assertArrayEquals(a.keys.loginToken, s.loginToken)
    assertArrayEquals(a.keys.readToken, s.readToken)
  }

  @Test fun signInRefusesAHeaderThatDoesNotMatchPrelogin() {
    val a = Account()
    val page = PullResponse(a.header.toJson(), 4, emptyList(), 9, false)
    for (h in listOf(a.header.copy(kdf = a.header.kdf.copy(iterations = 3)), a.header.copy(salt = ByteArray(16)), a.header.copy(accountKey = true))) {
      a.page = page.copy(header = h.toJson())
      assertThrows(SyncAuthError::class.java) { SyncClient.signInWithPassword(a.t, password) }
    }
    a.page = page.copy(header = "not a header")
    assertThrows(SyncAuthError::class.java) { SyncClient.signInWithPassword(a.t, password) }
  }

  @Test fun signInWithRecoveryOpensTheVault() {
    val a = Account(Crypto.randomBytes(20))
    val s = SyncClient.signInWithRecovery(a.t, a.recoveryKey)
    assertArrayEquals(a.vaultKey, s.vaultKey)
    assertArrayEquals(VaultFormat.recoveryLoginToken(a.recoveryKey), s.loginToken)
    assertNull(s.readToken)
    assertEquals(listOf(4L, 9L), listOf(s.headerRev, s.lastRev))
    assertThrows(SyncAuthError::class.java) { SyncClient.signInWithRecovery(a.t, RecoveryKey.generate()) }
  }

  @Test fun signInQuarantinesUnreadableRowsAndCountsBadOnes() {
    val a = Account()
    val garbage = Crypto.randomBytes(60)
    a.page = PullResponse(
      a.header.toJson(),
      4,
      listOf(
        WireRecord(rid, 5, b64(a.sealed)),
        WireRecord(id(2), 6, b64(garbage)),
        WireRecord(id(3), 7, "A".repeat(90_004)),
        WireRecord(id(4), 8, "not*base64"),
        WireRecord("NOT-AN-ID", 9, b64(a.sealed)),
      ),
      9,
      false,
    )
    val s = SyncClient.signInWithRecovery(a.t, a.recoveryKey)
    assertEquals(listOf(Triple(rid, a.sealed.toList(), 5L)), rows(s.records))
    assertEquals(listOf(Triple(id(2), garbage.toList(), 6L)), rows(s.quarantine))
    assertEquals(3, s.skipped)
  }
}
