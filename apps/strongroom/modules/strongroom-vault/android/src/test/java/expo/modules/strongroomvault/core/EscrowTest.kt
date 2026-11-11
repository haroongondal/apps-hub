package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class EscrowTest {
  private val e: JsonObject by lazy {
    Json.parseToJsonElement(javaClass.classLoader!!.getResource("vault-vectors.json")!!.readText()).jsonObject["escrow"]!!.jsonObject
  }
  private fun hex(key: String) = e[key]!!.jsonPrimitive.content.fromHex()

  private val code = ByteArray(20) { (it + 1).toByte() }
  private val recoveryKey = ByteArray(20) { (it + 40).toByte() }
  private val accountKey = ByteArray(20) { (it + 80).toByte() }

  @Test fun openReadsTheIndependentlyComputedBlob() {
    val keys = Escrow.open(hex("code"), hex("blob"))
    assertNotNull(keys)
    assertArrayEquals(hex("recoveryKey"), keys!!.recoveryKey)
    assertArrayEquals(hex("accountKey"), keys.accountKey)
  }

  @Test fun sealedBlobHasTheVectorsShapeAndOpensUnderTheVectorsLabel() {
    val blob = Escrow.seal(hex("code"), hex("recoveryKey"), hex("accountKey"))
    assertEquals(hex("blob").size, blob.size)
    val plain = Crypto.open(Crypto.hkdf(hex("code"), e["label"]!!.jsonPrimitive.content), blob, e["label"]!!.jsonPrimitive.content.toByteArray())
    assertArrayEquals(hex("recoveryKey") + hex("accountKey"), plain)
  }

  @Test fun sealThenOpenRoundTrips() {
    val keys = Escrow.open(code, Escrow.seal(code, recoveryKey, accountKey))
    assertNotNull(keys)
    assertArrayEquals(recoveryKey, keys!!.recoveryKey)
    assertArrayEquals(accountKey, keys.accountKey)
  }

  @Test fun aWrongCodeOpensNothing() {
    val blob = Escrow.seal(code, recoveryKey, accountKey)
    assertNull(Escrow.open(code.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }, blob))
  }

  @Test fun aBlobSealedAroundTheWrongLengthOpensNothing() {
    val short = Crypto.seal(Crypto.hkdf(code, "strongroom/v1/escrow"), recoveryKey + accountKey.copyOf(19), "strongroom/v1/escrow".toByteArray())
    assertNull(Escrow.open(code, short))
  }

  @Test fun aTamperedBlobOpensNothing() {
    val blob = Escrow.seal(code, recoveryKey, accountKey)
    for (i in listOf(0, 12, blob.size - 1)) {
      assertNull("byte $i", Escrow.open(code, blob.copyOf().also { it[i] = (it[i].toInt() xor 1).toByte() }))
    }
    assertNull(Escrow.open(code, blob.copyOf(blob.size - 1)))
  }

  @Test fun sealUsesAFreshNonceEachTime() {
    val a = Escrow.seal(code, recoveryKey, accountKey)
    val b = Escrow.seal(code, recoveryKey, accountKey)
    assertFalse(a.contentEquals(b))
  }

  @Test fun aBlobTooShortToHoldANonceAndTagOpensNothing() {
    assertNull(Escrow.open(code, ByteArray(0)))
    assertNull(Escrow.open(code, ByteArray(11)))
  }

  @Test fun sealRefusesKeysThatAreNot20Bytes() {
    assertThrows(IllegalArgumentException::class.java) { Escrow.seal(code, ByteArray(19), accountKey) }
    assertThrows(IllegalArgumentException::class.java) { Escrow.seal(code, recoveryKey, ByteArray(21)) }
  }
}
