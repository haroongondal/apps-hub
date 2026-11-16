package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LedgerBackfillTest {
  private val min = 60_000L
  private val hour = 60 * min
  private val t0 = 1_700_000_000_000L
  private val smsApp = "com.google.android.apps.messaging"
  private val items = MemoryItemStore()
  private val ledgerStore = MemoryLedgerStore()
  private var owner: String? = null
  private var n = 0

  init {
    items.hasSource = { ledgerStore.txnOfItem(it) != null }
  }

  private fun backfill() = LedgerBackfill(items, Ledger(ledgerStore, { owner }), { t0 })

  private fun runAll(limit: Int = 100): LedgerBackfill = backfill().also { while (it.runBatch(limit)) Unit }

  private fun save(text: String, at: Long, pkg: String = smsApp, sms: Boolean = true, email: Boolean = false, otp: Long? = null, emailText: String? = null): Long {
    n++
    val c = Capture(pkg, "App", "Alfalah", "k", null, null, null, text, at, "hash$n", false)
    val id = items.insert(c, "", otp, if (sms) "sms$n" else null, if (email) "email$n" else null)!!
    emailText?.let { items.items.getValue("hash$n").emailText = it }
    return id
  }

  // The Alfalah SMS formats of the plan's K1 table (synthetic names and numbers); the ninth format, the card charge, is `card` below.
  private val nine = listOf(
    "Dear Customer,\nPKR 5,000.00 Debited from your A/C: 0847-1***2310 on 2-Nov-26 at 18:45:48 Bal: Reply with AB 021111225111",
    "PKR 2490 has been transferred to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 at 12:30 via QR Tx ID FT26315ABCDEFGH1",
    "PKR 2,490.00 paid to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 12:32 via RAAST Tx FT26315ABCDEFGH1",
    "PKR 1,500.00 sent to Some Person TMB from your BAF A/C **2310 on 3-Nov-26 10:15:22 with Fee PKR 5.00 via FT Tx ID FT26307ZZZZZZZZZ",
    "PKR 300 sent to Some Person PK***1234 from your BAF A/C *2310 on 5-Nov-26 09:10 Tx ID FT26309YYYYYYYYY",
    "PKR 3,897.00 Paid to NTEL Consumer ID 123456 from your BAF A/C **2310 on 4-Nov-26 11:11:11 via UBPS Tx ID FT26308XXXXXXXX1",
    "PKR 50,000.00 received from Some Person BAF in your BAF A/C **2310 on 6-Nov-26 14:00:00 via FT Tx ID FT26310WWWWWWWWW",
    "PKR 1000 received from Some Person MUCBPKKKRTG in your BAF A/C *2310 via your Raast ID on 08-11-26 at 12:00 Tx ID FT26312VVVVVVVVV",
  )
  private val debited = nine[0]
  private val card =
    "Dear Customer,\nYour Debit Card against A/C: 0847-1***2310 is charged for PKR 1,500.00 on 12-Nov-26 at 16:23:38 at SHAAFI INTERNATIONAL HOSPIslamabad PK."

  @Test fun backfillAddsTransactionsForSavedMessages() {
    var at = t0
    val ids = nine.map { save(it, at).also { at += hour } }.toMutableList()
    repeat(3) { ids += save(debited, at).also { at += hour } }   // four "Debited from" in all, same amount
    ids += save(card, at)
    val b = runAll()
    // QR and RAAST of one Tx ID are one transaction: 8 table messages -> 7, plus 3 more debits, plus the card charge.
    assertEquals(11, ledgerStore.txns.size)
    assertEquals(4, ledgerStore.txns.values.count { it.amountMinor == 500_000L })
    assertEquals(1, ledgerStore.txns.values.count { it.amountMinor == 150_000L && it.counterparty != null && it.txId == null })
    assertEquals(1, ledgerStore.txns.values.count { it.amountMinor == 249_000L })
    assertTrue(ids.all { ledgerStore.txnOfItem(it) != null })
    assertEquals(12, b.linked)
  }

  @Test fun backfillSkipsItemsThatAlreadyHaveASource() {
    val id = save(card, t0)
    Ledger(ledgerStore, { null }).onItem(id, card, Channel.SMS_NOTIFICATION, t0)
    runAll()
    assertEquals(1, ledgerStore.txns.size)
    assertEquals(setOf(Channel.SMS_NOTIFICATION), ledgerStore.txns.values.single().channels)
    assertEquals(1, ledgerStore.sourceCount(ledgerStore.txns.keys.single()))
  }

  @Test fun backfillSkipsOtpAndBlankItems() {
    save(card, t0, otp = t0 + 5 * min)
    save("   ", t0 + hour)
    runAll()
    assertTrue(ledgerStore.txns.isEmpty())
    assertEquals(LedgerBackfill.VERSION.toString(), items.meta("ledgerPatternsVersion"))
  }

  @Test fun backfillIsIdempotent() {
    nine.forEachIndexed { i, text -> save(text, t0 + i * hour) }
    runAll()
    val before = ledgerStore.txns.toMap()
    val second = runAll()
    assertEquals(0, second.linked)
    assertEquals(before, ledgerStore.txns.toMap())
    // even with the version marker lost, items that already have a source are not read again
    items.setMeta("ledgerPatternsVersion", "1")
    items.setMeta("backfillCursor", "")
    assertEquals(0, runAll().linked)
    assertEquals(before, ledgerStore.txns.toMap())
  }

  @Test fun backfillResumesFromTheCursor() {
    repeat(5) { save(card.replace("1,500.00", "${it + 1},000.00"), t0 + it * hour) }
    val first = backfill()
    assertTrue(first.runBatch(2))
    assertEquals(2, ledgerStore.txns.size)
    assertEquals("${t0 + hour}:2", items.meta("backfillCursor"))
    assertNull(items.meta("ledgerPatternsVersion"))
    val second = backfill()   // a new instance (the process died) finishes
    while (second.runBatch(2)) Unit
    assertEquals(5, ledgerStore.txns.size)
    assertEquals(3, second.linked)
    assertEquals(LedgerBackfill.VERSION.toString(), items.meta("ledgerPatternsVersion"))
  }

  @Test fun backfillMapsChannels() {
    val sms = Sms.KNOWN_APPS + "com.vendor.sms"
    fun c(pkg: String, s: Boolean = false, e: Boolean = false) = LedgerBackfill.channelOf(pkg, s, e, sms)
    assertEquals(Channel.SMS, c("com.google.android.apps.messaging", s = true))
    assertEquals(Channel.SMS, c("com.other", s = true))
    assertEquals(Channel.SMS_NOTIFICATION, c("com.google.android.apps.messaging"))
    assertEquals(Channel.SMS_NOTIFICATION, c("com.vendor.sms"))
    assertEquals(Channel.EMAIL, c(Email.GMAIL, e = true))
    assertEquals(Channel.EMAIL_NOTIFICATION, c(Email.GMAIL))
    assertEquals(Channel.NOTIFICATION, c("com.whatsapp"))
    // and the store hands the backfill the channel and the email text
    save(card, t0, sms = false)
    save(card, t0 + hour, pkg = Email.GMAIL, sms = false, email = true, emailText = "PKR 300 sent to Some Person from your BAF A/C *2310 on 5-Nov-26 09:10 Tx ID FT26309YYYYYYYYY")
    val got = items.unparsed(0, 0, 10)
    assertEquals(listOf(Channel.SMS_NOTIFICATION, Channel.EMAIL), got.map { it.channel })
    assertTrue(got[1].text.startsWith("PKR 300"))
  }

  @Test fun ownNameAppliesAfterTheBackfill() {
    owner = "Some Person"
    // The first message names nobody; the second merges into it and brings the counterparty, so only the final pass can mark it own.
    save(debited, t0, sms = false)
    save("PKR 5,000.00 sent to Some Person BAF from your BAF A/C **2310 on 2-Nov-26 18:46:10 Tx ID FT26307AAAAAAAAA", t0 + min)
    runAll()
    val t = ledgerStore.txns.values.single()
    assertEquals("Some Person BAF", t.counterparty)
    assertTrue(t.own)
  }

  @Test fun versionMetaPreventsAnotherRun() {
    items.setMeta("ledgerPatternsVersion", LedgerBackfill.VERSION.toString())
    save(card, t0)
    val b = backfill()
    assertFalse(b.runBatch())
    assertTrue(ledgerStore.txns.isEmpty())
    items.setMeta("ledgerPatternsVersion", "1")   // an older pattern set runs once more
    runAll()
    assertEquals(1, ledgerStore.txns.size)
    assertEquals(LedgerBackfill.VERSION.toString(), items.meta("ledgerPatternsVersion"))
  }
}
