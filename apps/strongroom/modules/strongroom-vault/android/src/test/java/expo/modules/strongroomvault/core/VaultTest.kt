package expo.modules.strongroomvault.core

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class VaultTest {
  private val fast = KdfParams(1024, 1, 1)
  private val password = "correct horse battery staple".toCharArray()
  private val recoveryKey = ByteArray(20) { (it + 1).toByte() }
  private val minute = 60_000L
  private var wall = 1_700_000_000_000L
  private var elapsed = 0L
  private val store = MemoryRecordStore()
  private val login = Entry.Login("Example", "me@example.com", "hunter2-unique", listOf(Site(true, "example.com")), emptyList(), "", 1)
  private val card = Entry.Card("Visa", "A. Holder", "4111 1111 1111 9876", 12, 2030, "321", "", 1)
  private val note = Entry.Note("Wi-Fi", "the secret text", 1)

  @Before fun lowerKdfFloor() {
    KdfParams.testFloor = fast
  }

  @After fun clearKdfFloor() {
    KdfParams.testFloor = null
  }

  private fun vault(s: RecordStore = store) = Vault(s, { wall }, { elapsed })

  private fun setUpVault() = vault().also { it.setUp(password, recoveryKey, fast) }

  private fun internalKey(v: Vault) = Vault::class.java.getDeclaredField("key").apply { isAccessible = true }.get(v) as ByteArray?

  private fun isZeroed(a: ByteArray) = a.all { it == 0.toByte() }

  private fun assertLocked(block: () -> Unit) =
    assertEquals("locked", assertThrows(IllegalStateException::class.java) { block() }.message)

  private fun storedHeader() = Header.fromJson(store.header()!!)!!

  @Test fun lockedVaultRefusesReads() {
    val v = setUpVault()
    val id = v.put(null, login)
    v.lock()
    assertLocked { v.rows() }
    assertLocked { v.get(id) }
    assertLocked { v.all() }
    assertLocked { v.put(null, login) }
    assertLocked { v.put(id, login) }
    assertLocked { v.delete(id) }
    assertLocked { v.putMany(listOf(login)) }
    assertLocked { v.changePassword(password, "another password!".toCharArray()) }
    assertLocked { v.newRecoveryKey(password) }
    assertLocked { v.vaultKeyCopy(password) }
    v.touch()
    assertFalse(v.isUnlocked)
  }

  @Test fun aNeverUnlockedVaultIsLockedAndNotSetUp() {
    val v = vault()
    assertFalse(v.isSetUp)
    assertFalse(v.isUnlocked)
    assertLocked { v.rows() }
  }

  @Test fun setUpLeavesTheVaultUnlockedAndKeepsTheHeader() {
    val v = setUpVault()
    assertTrue(v.isSetUp)
    assertTrue(v.isUnlocked)
    assertEquals(0, v.unreadable)
    assertEquals(fast, storedHeader().kdf)
    assertEquals(emptyList<Row>(), v.rows())
  }

  @Test fun putGetDeleteAndRowsHideTombstones() {
    val v = setUpVault()
    val id = v.put(null, login)
    assertEquals(login.copy(updatedAt = wall), v.get(id))
    assertEquals(mapOf(id to login.copy(updatedAt = wall)), v.all())
    assertEquals(listOf(Row(id, "login", "Example", "me@example.com")), v.rows())

    wall += 5
    assertEquals(id, v.put(id, login.copy(username = "other", updatedAt = 99)))
    assertEquals(login.copy(username = "other", updatedAt = wall), v.get(id))
    assertEquals(1, store.records.size)

    wall += 5
    v.delete(id)
    assertNull(v.get(id))
    assertEquals(emptyMap<String, Entry>(), v.all())
    assertEquals(emptyList<Row>(), v.rows())
    assertEquals(Entry.Deleted(wall), VaultFormat.openEntry(internalKey(v)!!, id, store.records.getValue(id)))
    assertNull(v.get("no-such-id"))
  }

  @Test fun putWithoutAnIdMakesAFreshIdEachTime() {
    val v = setUpVault()
    val a = v.put(null, login)
    val b = v.put(null, login)
    assertTrue(a != b && a.isNotEmpty() && b.isNotEmpty())
    assertEquals(setOf(a, b), v.all().keys)
  }

  @Test fun rowSubtitles() {
    val v = setUpVault()
    val loginId = v.put(null, login)
    val visaId = v.put(null, card)
    val giftId = v.put(null, card.copy(name = "Gift", number = "12"))
    val noteId = v.put(null, note)
    val bullets = "\u2022\u2022\u2022\u2022 "
    assertEquals(
      listOf(
        Row(loginId, "login", "Example", "me@example.com"),
        Row(giftId, "card", "Gift", bullets + "12"),
        Row(visaId, "card", "Visa", bullets + "9876"),
        Row(noteId, "note", "Wi-Fi", ""),
      ),
      v.rows(),
    )
  }

  @Test fun rowsNeverContainPasswords() {
    val v = setUpVault()
    v.put(null, login)
    v.put(null, card)
    v.put(null, note)
    val secrets = listOf(login.password, card.number, card.cvc, note.text)
    for (row in v.rows()) {
      for (field in listOf(row.id, row.type, row.name, row.subtitle)) {
        for (s in secrets) assertFalse("$field leaks $s", s in field)
      }
    }
  }

  @Test fun corruptRecordIsCountedNotDeleted() {
    val v = setUpVault()
    val id = v.put(null, login)
    val garbage = ByteArray(40) { it.toByte() }
    store.records["garbage"] = garbage
    store.records["short"] = byteArrayOf(1, 2, 3)
    v.lock()

    assertTrue(v.unlock(password))
    assertEquals(2, v.unreadable)
    assertEquals(listOf(id), v.rows().map { it.id })
    assertEquals(setOf(id, "garbage", "short"), store.all().keys)
    assertArrayEquals(garbage, store.all().getValue("garbage"))
    assertEquals(setOf(id), v.all().keys)
  }

  @Test fun putManyIsOneTransaction() {
    val v = setUpVault()
    assertEquals(0, store.putAllCalls)
    assertEquals(3, v.putMany(listOf(login, card, note)))
    assertEquals(1, store.putAllCalls)
    assertEquals(3, v.all().size)
    assertEquals(setOf(wall), v.all().values.map { it.updatedAt }.toSet())
  }

  @Test fun lockZeroesTheKey() {
    val v = setUpVault()
    val copy = v.vaultKeyCopy(password)!!
    val internal = internalKey(v)!!
    assertFalse(isZeroed(internal))
    v.lock()
    assertFalse(v.isUnlocked)
    assertTrue(isZeroed(internal))
    assertFalse(isZeroed(copy))
    assertTrue(v.unlockWithKey(copy))
    assertTrue(v.isUnlocked)
  }

  @Test fun unlockRejectsAWrongPasswordAndAcceptsTheRightOne() {
    setUpVault().lock()
    val v = vault()
    assertTrue(v.isSetUp)
    assertFalse(v.unlock("wrong password here".toCharArray()))
    assertFalse(v.isUnlocked)
    assertTrue(v.unlock(password))
    assertTrue(v.isUnlocked)
  }

  @Test fun changePasswordKeepsRecords() {
    val v = setUpVault()
    val id = v.put(null, login)
    val before = store.records.mapValues { it.value.copyOf() }
    val next = "an entirely new password".toCharArray()

    assertFalse(v.changePassword("not the password".toCharArray(), next))
    assertTrue(v.changePassword(password, next))
    assertEquals(before.keys, store.records.keys)
    for ((k, bytes) in before) assertArrayEquals(bytes, store.records.getValue(k))

    v.lock()
    assertFalse(v.unlock(password))
    assertTrue(v.unlock(next))
    assertEquals(login.copy(updatedAt = wall), v.get(id))
    v.lock()
    assertTrue(v.recover(recoveryKey, password))
  }

  @Test fun recoverSetsNewPassword() {
    val v = setUpVault()
    val id = v.put(null, login)
    v.lock()
    val next = "a brand new password".toCharArray()

    assertFalse(v.recover(ByteArray(20), next))
    assertFalse(v.isUnlocked)
    assertTrue(v.recover(recoveryKey, next))
    assertTrue(v.isUnlocked)
    assertEquals(login.copy(updatedAt = wall), v.get(id))
    v.lock()
    assertFalse(v.unlock(password))
    assertTrue(v.unlock(next))
  }

  @Test fun setUpTwiceIsRefused() {
    val v = setUpVault()
    val first = store.header()
    val e = assertThrows(IllegalStateException::class.java) { v.setUp("another password!".toCharArray(), ByteArray(20), fast) }
    assertEquals("already set up", e.message)
    assertEquals(first, store.header())
    v.lock()
    assertTrue(v.unlock(password))
  }

  @Test fun setUpRefusesKdfOutOfRange() {
    assertThrows(KdfOutOfRange::class.java) { vault().setUp(password, recoveryKey, KdfParams(1024, 99, 1)) }
    assertNull(store.header())
  }

  @Test fun newRecoveryKeyNeedsCurrentPassword() {
    val v = setUpVault()
    assertNull(v.newRecoveryKey("not the password".toCharArray()))
    v.lock()
    assertTrue(v.recover(recoveryKey, password))

    val fresh = v.newRecoveryKey(password)!!
    assertEquals(20, fresh.size)
    v.lock()
    assertFalse(v.recover(recoveryKey, password))
    assertTrue(v.recover(fresh, password))
  }

  @Test fun enableBiometricNeedsCurrentPassword() {
    val v = setUpVault()
    assertNull(v.vaultKeyCopy("not the password".toCharArray()))
    val copy = v.vaultKeyCopy(password)!!
    assertArrayEquals(VaultFormat.unlockWithPassword(storedHeader(), password), copy)
    assertNotSame(internalKey(v), copy)
    copy.fill(0)
    assertFalse(isZeroed(internalKey(v)!!))
  }

  @Test fun unlockWithKeyChecksTheRecordsItOpens() {
    val v = setUpVault()
    val id = v.put(null, login)
    val key = v.vaultKeyCopy(password)!!
    v.lock()

    assertFalse(v.unlockWithKey(ByteArray(32)))
    assertFalse(v.unlockWithKey(ByteArray(7)))
    assertFalse(v.isUnlocked)
    assertTrue(v.unlockWithKey(key))
    assertNotSame(key, internalKey(v))
    assertEquals(login.copy(updatedAt = wall), v.get(id))

    store.records["garbage"] = ByteArray(40)
    v.lock()
    assertTrue(v.unlockWithKey(key))
    assertEquals(1, v.unreadable)

    val emptyStore = MemoryRecordStore().also { it.putHeader(store.header()!!) }
    assertTrue(vault(emptyStore).unlockWithKey(key))
  }

  @Test fun expiresAcrossSleepWithElapsedClock() {
    val v = setUpVault()
    val internal = internalKey(v)!!
    elapsed += 6 * minute
    assertFalse(v.isUnlocked)
    assertTrue(isZeroed(internal))
    assertNull(internalKey(v))
  }

  @Test fun expiredVaultLocksBeforeServing() {
    val v = setUpVault()
    val id = v.put(null, login)
    elapsed = 4 * minute
    assertNotNull(v.get(id))
    v.put(id, login)
    elapsed = 5 * minute
    assertLocked { v.rows() }
  }

  @Test fun touchExtendsTheSession() {
    val v = setUpVault()
    v.put(null, login)
    elapsed = 4 * minute
    v.touch()
    elapsed = 5 * minute
    assertEquals(1, v.rows().size)
    elapsed = 9 * minute - 1
    assertTrue(v.isUnlocked)
    elapsed = 9 * minute
    assertFalse(v.isUnlocked)
  }

  @Test fun touchAfterExpiryDoesNotResurrectTheSession() {
    val v = setUpVault()
    elapsed = 5 * minute
    v.touch()
    assertFalse(v.isUnlocked)
    assertLocked { v.rows() }
  }

  @Test fun unlockStartsAFreshTimeout() {
    val v = setUpVault()
    elapsed = 4 * minute
    v.lock()
    assertTrue(v.unlock(password))
    elapsed = 8 * minute
    assertTrue(v.isUnlocked)
  }

  @Test fun autoLockMinutesDefaultsToFiveAndTakesOnlyValidValues() {
    val v = vault()
    assertEquals(5, v.autoLockMinutes)
    for (m in listOf(1, 15, 5)) {
      v.autoLockMinutes = m
      assertEquals(m, v.autoLockMinutes)
    }
    for (m in listOf(0, 2, 10, 60, -1)) assertThrows(IllegalArgumentException::class.java) { v.autoLockMinutes = m }
    assertEquals(5, v.autoLockMinutes)
  }

  @Test fun theTimeoutSettingApplies() {
    val v = setUpVault()
    v.autoLockMinutes = 1
    elapsed = minute
    assertFalse(v.isUnlocked)
    assertTrue(v.unlock(password))
    v.autoLockMinutes = 15
    elapsed += 14 * minute
    assertTrue(v.isUnlocked)
  }

  @Test fun anExpiredSessionDoesNotOutliveALongerTimeout() {
    val v = setUpVault()
    v.autoLockMinutes = 1
    elapsed = 3 * minute
    v.autoLockMinutes = 15
    assertFalse(v.isUnlocked)
  }

  @Test fun anUnreadableHeaderIsSetUpButNeitherUnlocksNorRecovers() {
    store.putHeader("{not json")
    val v = vault()
    assertTrue(v.isSetUp)
    assertEquals("header unreadable", assertThrows(IllegalStateException::class.java) { v.unlock(password) }.message)
    assertEquals("header unreadable", assertThrows(IllegalStateException::class.java) { v.recover(recoveryKey, password) }.message)
    assertEquals("already set up", assertThrows(IllegalStateException::class.java) { v.setUp(password, recoveryKey, fast) }.message)
    assertFalse(v.isUnlocked)
  }

  @Test fun unlockingAVaultThatWasNeverSetUpIsAnError() {
    assertEquals("not set up", assertThrows(IllegalStateException::class.java) { vault().unlock(password) }.message)
  }

  @Test fun aRefusedHeaderIsNotAWrongPassword() {
    val v = setUpVault()
    v.lock()
    store.putHeader(storedHeader().copy(kdf = KdfParams(1024, 99, 1)).toJson())
    assertThrows(KdfOutOfRange::class.java) { v.unlock(password) }
    assertThrows(KdfOutOfRange::class.java) { v.recover(recoveryKey, password) }
    assertFalse(v.isUnlocked)
  }
}
