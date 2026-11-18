package expo.modules.strongroomvault.core

import expo.modules.strongroomvault.core.MigrationImport.Existing
import expo.modules.strongroomvault.core.MigrationImport.Item
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Authenticator migration format (DESIGN §15.5), checked against the real export's shape (Task 7 Step 0). */
class MigrationImportTest {
  // --- a tiny protobuf writer for the fixtures -------------------------------------------

  private fun varint(v: Long): ByteArray {
    var x = v
    val out = ArrayList<Byte>()
    while (true) {
      val b = (x and 0x7F).toInt()
      x = x ushr 7
      out.add((if (x == 0L) b else b or 0x80).toByte())
      if (x == 0L) return out.toByteArray()
    }
  }

  private fun num(field: Int, v: Long): ByteArray = varint((field.toLong() shl 3) or 0) + varint(v)

  private fun len(field: Int, data: ByteArray): ByteArray = varint((field.toLong() shl 3) or 2) + varint(data.size.toLong()) + data

  private fun fixed32(field: Int, a: Int): ByteArray = varint((field.toLong() shl 3) or 5) + byteArrayOf(a.toByte(), 0, 0, 0)

  private fun fixed64(field: Int, a: Long): ByteArray = varint((field.toLong() shl 3) or 1) + byteArrayOf(a.toByte(), 0, 0, 0, 0, 0, 0, 0)

  private fun joined(parts: List<ByteArray>): ByteArray = parts.reduce { a, b -> a + b }

  private val chip = ByteArray(19) { it.toByte() } // the unknown field 8 every real entry carries

  private fun otp(
    secret: ByteArray,
    name: String? = null,
    issuer: String? = null,
    algorithm: Int? = null,
    digits: Int? = null,
    type: Int? = null,
    counter: Long? = null,
    unknown8: ByteArray? = chip,
  ): ByteArray = joined(
    listOfNotNull(
      len(1, secret),
      name?.let { len(2, it.toByteArray(Charsets.UTF_8)) },
      issuer?.let { len(3, it.toByteArray(Charsets.UTF_8)) },
      algorithm?.let { num(4, it.toLong()) },
      digits?.let { num(5, it.toLong()) },
      type?.let { num(6, it.toLong()) },
      counter?.let { num(7, it) },
      unknown8?.let { len(8, it) },
    ),
  )

  /** A batch QR the way Authenticator shows it: standard base64, percent-escaped in the query. */
  private fun batchUri(
    entries: List<ByteArray>,
    version: Long? = 2,
    size: Int? = 1,
    index: Int? = 0,
    extraTop: ByteArray? = null,
    urlSafe: Boolean = false,
  ): String {
    val payload = joined(entries.map { len(1, it) } + listOfNotNull(
      version?.let { num(2, it) },
      size?.let { num(3, it.toLong()) },
      index?.let { num(4, it.toLong()) },
      extraTop,
    ))
    val b64 = if (urlSafe) java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(payload)
    else java.util.Base64.getEncoder().encodeToString(payload)
    return "otpauth-migration://offline?data=" + java.net.URLEncoder.encode(b64, "UTF-8")
  }

  private val secret16 = ByteArray(16) { (it + 1).toByte() }
  private val secret20 = ByteArray(20) { (it + 3).toByte() }

  // --- the format ------------------------------------------------------------------------

  @Test fun aRealShapedBatchParses() {
    val uri = batchUri(
      listOf(
        otp(secret16, name = "ana@acme.example", issuer = "Acme", algorithm = 1, digits = 1, type = 2),
        otp(secret20, name = "bob@other.example", issuer = "Other", algorithm = 2, digits = 2, type = 2),
      ),
      version = 2, size = 2, index = 0,
    )
    val batch = MigrationImport.parse(uri)
    assertEquals(2, batch.entries.size)
    assertEquals(2L, batch.version)
    assertEquals(2, batch.batchSize)
    assertEquals(0, batch.batchIndex)
    val first = batch.entries[0]
    assertTrue(secret16.contentEquals(first.secret))
    assertEquals("ana@acme.example", first.name)
    assertEquals("Acme", first.issuer)
    assertEquals(1L, first.algorithm)
    assertEquals(1L, first.digits)
    assertEquals(2L, first.type)
    assertEquals(0L, first.counter)
  }

  @Test fun urlSafeBase64WithoutPaddingParsesToo() {
    val uri = batchUri(listOf(otp(secret16, name = "a", type = 2)), version = 2, size = 1, index = 0, urlSafe = true)
    assertEquals(1, MigrationImport.parse(uri).entries.size)
  }

  @Test fun unknownFieldsAreSkipped() {
    // Field 8 on every entry and an unknown top-level field, as the real export carries.
    val uri = batchUri(listOf(otp(secret16, name = "a", type = 2, unknown8 = chip)), extraTop = len(9, byteArrayOf(1, 2, 3)))
    assertEquals(1, MigrationImport.parse(uri).entries.size)
  }

  @Test fun unknownFixedSizeFieldsAreSkipped() {
    // Wire types 1 (fixed64) and 5 (fixed32) on unknown fields skip over their fixed size.
    val uri = batchUri(
      listOf(otp(secret16, name = "a", type = 2)),
      extraTop = fixed64(11, 9) + fixed32(10, 7),
    )
    assertEquals(1, MigrationImport.parse(uri).entries.size)
  }

  @Test fun aTruncatedFixedFieldRefuses() {
    // A fixed64 whose 8 bytes run past the end: damaged, never silently truncated.
    val payload = varint((11L shl 3) or 1) + byteArrayOf(1, 2, 3)
    val b64 = java.util.Base64.getEncoder().encodeToString(payload)
    try {
      MigrationImport.parse("otpauth-migration://offline?data=$b64")
      org.junit.Assert.fail("a truncated fixed64 must refuse")
    } catch (expected: MigrationImport.ImportError) {
      assertEquals("The export data is not readable", expected.message)
    }
  }

  @Test fun aVarintWhereBytesBelongRefuses() {
    // Field 1 of the payload as a varint instead of an OtpParameters message: a clean
    // refusal, not a ClassCastException.
    val b64 = java.util.Base64.getEncoder().encodeToString(num(1, 5))
    try {
      MigrationImport.parse("otpauth-migration://offline?data=$b64")
      org.junit.Assert.fail("a varint where a message belongs must refuse")
    } catch (expected: MigrationImport.ImportError) {
      assertEquals("The export data is not readable", expected.message)
    }
  }

  @Test fun aVarintSecretRefuses() {
    // Field 1 of OtpParameters as a varint instead of the secret's bytes.
    val uri = batchUri(listOf(num(1, 5) + num(6, 2)), size = 1, index = 0)
    try {
      MigrationImport.parse(uri)
      org.junit.Assert.fail("a varint secret must refuse")
    } catch (expected: MigrationImport.ImportError) {
      assertEquals("The export data is not readable", expected.message)
    }
  }

  @Test fun damagedPayloadsRefuse() {
    fun refused(uri: String, why: String) {
      try {
        MigrationImport.parse(uri)
        org.junit.Assert.fail(why)
      } catch (e: MigrationImport.ImportError) {
        assertNotNull(e.message)
      }
    }
    refused("https://example.com/x", "wrong scheme")
    refused("otpauth-migration://export?data=AAAA", "wrong host")
    refused("otpauth-migration://offline", "no query")
    refused("otpauth-migration://offline?other=1", "no data param")
    refused("otpauth-migration://offline?data=!!!", "bad base64")
    // A length that runs past the end of the message.
    val truncated = java.util.Base64.getEncoder().encodeToString(byteArrayOf(0x0A, 0x7F, 0x01))
    refused("otpauth-migration://offline?data=$truncated", "length past the end")
    // A batch count of zero (absent) is impossible; an index outside the count too.
    refused(batchUri(listOf(otp(secret16, type = 2)), size = null, index = 0), "absent batch size")
    refused(batchUri(listOf(otp(secret16, type = 2)), size = 1, index = 1), "index outside the size")
    refused(batchUri(listOf(otp(secret16, type = 2)), size = 0, index = 0), "impossible batch size")
  }

  // --- the constructed URI ---------------------------------------------------------------

  @Test fun theConstructedUriParsesBackThroughOtp() {
    val uri = MigrationImport.uriOf(MigrationImport.Params(secret16, "ana@acme.example", "Acme", 2, 2, 2, 0))
    assertNotNull(uri)
    val totp = Otp.parse(uri!!)
    assertNotNull(totp)
    assertEquals("Acme", totp!!.issuer)
    assertEquals("ana@acme.example", totp.account)
    assertEquals(Otp.Digest.SHA256, totp.algorithm)
    assertEquals(8, totp.digits)
    assertEquals(30, totp.period)
    assertTrue(secret16.contentEquals(totp.secret))
  }

  @Test fun aNameAlreadyCarryingTheIssuerPrefixIsNotDoubled() {
    val uri = MigrationImport.uriOf(MigrationImport.Params(secret16, "Acme:ana@acme.example", "Acme", 1, 1, 2, 0))!!
    val totp = Otp.parse(uri)!!
    assertEquals("Acme", totp.issuer)
    assertEquals("ana@acme.example", totp.account)
  }

  @Test fun anIssuerlessEntryUsesItsName() {
    val uri = MigrationImport.uriOf(MigrationImport.Params(secret16, "ana@acme.example", null, 1, 1, 2, 0))!!
    val totp = Otp.parse(uri)!!
    // A plain label: no issuer, the whole label the account.
    assertEquals(null, totp.issuer)
    assertEquals("ana@acme.example", totp.account)
  }

  @Test fun anOldStyleLabelSplitsAtItsColon() {
    val uri = MigrationImport.uriOf(MigrationImport.Params(secret16, "Acme:ana@acme.example", null, 1, 1, 2, 0))!!
    val totp = Otp.parse(uri)!!
    assertEquals("Acme", totp.issuer)
    assertEquals("ana@acme.example", totp.account)
  }

  @Test fun anIssuerOnlyEntryHasNoAccount() {
    val uri = MigrationImport.uriOf(MigrationImport.Params(secret16, null, "Acme", 1, 1, 2, 0))!!
    val totp = Otp.parse(uri)!!
    assertEquals("Acme", totp.issuer)
    assertEquals(null, totp.account)
  }

  @Test fun aNonLatinIssuerSurvivesTheUri() {
    val issuer = "سرویس"
    val uri = MigrationImport.uriOf(MigrationImport.Params(secret16, "user@example.com", issuer, 1, 1, 2, 0))!!
    val totp = Otp.parse(uri)!!
    assertEquals(issuer, totp.issuer)
    assertEquals("user@example.com", totp.account)
  }

  // --- the review ------------------------------------------------------------------------

  private fun existing(id: String, name: String, username: String, totp: String? = null) = Existing(id, name, username, totp)

  @Test fun hotpIsSkippedAndCounted() {
    val batch = MigrationImport.parse(batchUri(listOf(
      otp(secret16, name = "ana", issuer = "Acme", type = 1, counter = 42),
      otp(secret20, name = "bob", issuer = "Other", type = 2),
    ), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), emptyList())
    assertEquals(1, review.hotp)
    assertEquals(1, review.created)
    assertEquals(0, review.bad)
    val item = review.items.single() as Item.Create
    assertEquals("Other", item.loginName)
    assertEquals("bob", item.username)
  }

  @Test fun outOfRangeEntriesAreCountedNotCrashed() {
    val batch = MigrationImport.parse(batchUri(listOf(
      otp(ByteArray(9), name = "short", type = 2), // below the §15.1 floor
      otp(ByteArray(65), name = "long", type = 2), // above the ceiling
      otp(secret16, name = "md5", type = 2, algorithm = 4),
      otp(secret16, name = "digits3", type = 2, digits = 3),
    ), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), emptyList())
    assertEquals(4, review.bad)
    assertEquals(0, review.created)
  }

  @Test fun anUnnamedEntryIsRefused() {
    val uri = batchUri(listOf(otp(secret16, type = 2)), size = 1, index = 0) // no name, no issuer
    val batch = MigrationImport.parse(uri)
    val review = MigrationImport.review(listOf(batch), emptyList())
    assertEquals(1, review.bad)
  }

  @Test fun duplicatesWithinTheImportCollapse() {
    val batch = MigrationImport.parse(batchUri(listOf(
      otp(secret16, name = "ana", issuer = "Acme", type = 2),
      otp(secret16.copyOf(), name = "ana again", issuer = "Acme", type = 2),
    ), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), emptyList())
    assertEquals(1, review.created)
    assertEquals(1, review.duplicates)
  }

  @Test fun aCodeTheVaultAlreadyHoldsIsADuplicate() {
    val stored = "otpauth://totp/Acme:ana?secret=" + MigrationImport.base32Of(secret16) + "&issuer=Acme"
    val batch = MigrationImport.parse(batchUri(listOf(otp(secret16, name = "ana", issuer = "Acme", type = 2)), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), listOf(existing("1", "Acme", "ana", stored)))
    assertEquals(0, review.created)
    assertEquals(1, review.duplicates)
  }

  @Test fun attachMatchesIssuerAndAccountWithoutCase() {
    val batch = MigrationImport.parse(batchUri(listOf(otp(secret16, name = "ana@x.example", issuer = "GitHub", type = 2)), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), listOf(existing("7", "github", "ANA@X.EXAMPLE")))
    val item = review.items.single()
    assertTrue(item is Item.Attach)
    item as Item.Attach
    assertEquals("7", item.loginId)
    assertEquals("github", item.loginName)
    assertEquals("GitHub", item.issuer)
    assertEquals("ana@x.example", item.account)
    assertEquals(1, review.attached)
    assertEquals(0, review.created)
  }

  @Test fun aLoginAlreadyHoldingACodeIsNeverAnAttachTarget() {
    val other = "otpauth://totp/Other:bob?secret=" + MigrationImport.base32Of(secret20) + "&issuer=Other"
    val batch = MigrationImport.parse(batchUri(listOf(otp(secret16, name = "ana", issuer = "Acme", type = 2)), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), listOf(existing("7", "Acme", "ana", other)))
    val item = review.items.single()
    assertTrue(item is Item.Create)
    assertEquals(0, review.attached)
  }

  @Test fun anAccountMismatchCreatesInsteadOfAttaching() {
    val batch = MigrationImport.parse(batchUri(listOf(otp(secret16, name = "ana@x.example", issuer = "Acme", type = 2)), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), listOf(existing("7", "Acme", "bob@x.example")))
    assertTrue(review.items.single() is Item.Create)
  }

  @Test fun aBlankUsernameOnAMatchingNameAttaches() {
    val batch = MigrationImport.parse(batchUri(listOf(otp(secret16, name = null, issuer = "Acme", type = 2)), size = 1, index = 0))
    val review = MigrationImport.review(listOf(batch), listOf(existing("7", "ACME", "")))
    assertTrue(review.items.single() is Item.Attach)
  }

  @Test fun batchesAreOrderedByIndexBeforeReview() {
    // The export's last batch (short, index 1) may be photographed before its first.
    val first = MigrationImport.parse(batchUri(listOf(otp(secret16, name = "a", issuer = "A", type = 2)), size = 2, index = 0))
    val last = MigrationImport.parse(batchUri(listOf(otp(secret20, name = "b", issuer = "B", type = 2)), size = 2, index = 1))
    val review = MigrationImport.review(listOf(last, first), emptyList())
    val names = review.items.map { (it as Item.Create).loginName }
    assertEquals(listOf("A", "B"), names)
  }

  @Test fun base32RoundTripsThroughTheOtpParser() {
    for (len in intArrayOf(10, 16, 20, 21, 32, 40, 64)) {
      val bytes = ByteArray(len) { (it * 7 + 3).toByte() }
      val uri = "otpauth://totp/X?secret=" + MigrationImport.base32Of(bytes)
      assertTrue(Otp.parse(uri)!!.secret.contentEquals(bytes))
    }
  }
}
