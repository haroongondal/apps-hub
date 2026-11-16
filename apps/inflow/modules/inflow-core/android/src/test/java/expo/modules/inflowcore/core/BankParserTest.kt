package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BankParserTest {
  private val credit =
    "Dear Customer,\nPKR 593,249.01 Credited to your A/C: 0847-1***2310 on 13-Nov-26 at 12:02:54\nBal: Reply with AB\n021111225111"
  private val debit =
    "Dear Customer,\nYour Debit Card against A/C: 0847-1***2310 is charged for PKR 1,500.00 on 12-Nov-26 at 16:23:38 at SHAAFI INTERNATIONAL HOSPIslamabad PK."
  private val ubl =
    "PKR 50,000 received from HAROON MUKHTAR* in your UBL A/C *1733 on 01-OCT-2026 21:03 via your Raast ID. Tx ID 7224343340. For info 111825888."

  @Test fun alfalahCredit() {
    assertEquals(Parsed(Direction.IN, 59324901, "PKR", "Alfalah 2310", null, null), BankParser.parse(credit))
  }

  @Test fun alfalahDebit() {
    assertEquals(
      Parsed(Direction.OUT, 150000, "PKR", "Alfalah 2310", "SHAAFI INTERNATIONAL HOSPIslamabad PK", null),
      BankParser.parse(debit),
    )
  }

  @Test fun ublRaast() {
    assertEquals(Parsed(Direction.IN, 5000000, "PKR", "UBL 1733", "HAROON MUKHTAR*", "7224343340"), BankParser.parse(ubl))
  }

  @Test fun lineBreaksAndDoubleSpacesParseTheSame() {
    val messy = { s: String -> s.replace(" ", "  ").replace("\n", "\r\n") }
    assertEquals(BankParser.parse(credit), BankParser.parse(messy(credit)))
    assertEquals(BankParser.parse(debit), BankParser.parse(messy(debit)))
    assertEquals(BankParser.parse(ubl), BankParser.parse(messy(ubl)))
    assertEquals(BankParser.parse(ubl), BankParser.parse(ubl.replace(" ", "\n")))
  }

  @Test fun caseDoesNotMatter() {
    assertEquals(BankParser.parse(credit), BankParser.parse(credit.uppercase()))
  }

  @Test fun amountsWithoutCommasOrDecimals() {
    assertEquals(150000L, BankParser.parse(debit.replace("1,500.00", "1500"))?.amountMinor)
    assertEquals(150050L, BankParser.parse(debit.replace("1,500.00", "1,500.5"))?.amountMinor)
  }

  @Test fun notMoneyGivesNull() {
    assertNull(BankParser.parse("Mahana 5GB 12 ghantay main khatam ho jaye gi. Abhi recharge karein."))
    assertNull(BankParser.parse("OTP 123456 for PKR 25,000 at Daraz"))
    assertNull(BankParser.parse("Get PKR 500 cashback on your next order"))
  }

  private val ublEmail = Samples.UBL_EMAIL
  private val alfalahEmail = Samples.ALFALAH_EMAIL

  @Test fun ublRaastOutEmail() {
    assertEquals(
      Parsed(Direction.OUT, 700000, "PKR", "UBL 33", "JAYISHA NOOR", "1430551744", accountPartial = true),
      BankParser.parse(ublEmail),
    )
  }

  @Test fun alfalahPosEmail() {
    val want = Parsed(Direction.OUT, 170000, "PKR", "Alfalah 2310", null, "FT263160G6MC4S12")
    assertEquals(want, BankParser.parse(alfalahEmail))
    val joined = alfalahEmail.lines().filter { it.isNotBlank() }.joinToString(" ")
    assertEquals(want, BankParser.parse(joined))
  }

  @Test fun alfalahNonPosEmailIsNull() {
    assertNull(BankParser.parse(alfalahEmail.replace("POS", "IBFT")))
  }

  @Test fun taxLineIsNotAmount() {
    assertNull(BankParser.parse(alfalahEmail.replace("Amount\n\nPKR 1,700.00/-\n\n", "")))
  }

  @Test fun hyphenatedBranchNameDoesNotBreakTheAccount() {
    val text = Samples.UBL_EMAIL.replace("Pwd Colony Road Branch, Islamabad", "F-10 Markaz Branch, Islamabad")
    assertEquals("UBL 33", BankParser.parse(text)?.account)
    assertEquals(true, BankParser.parse(text)?.accountPartial)
  }

  // Alfalah SMS formats (stage 4b K1): the real wording with the owner's numbers and names replaced.
  private fun alfalah(direction: Direction, minor: Long, counterparty: String?, txId: String?) =
    Parsed(direction, minor, "PKR", "Alfalah 2310", counterparty, txId)

  @Test fun alfalahDebitedFromYourAccount() {
    assertEquals(
      alfalah(Direction.OUT, 500000, null, null),
      BankParser.parse("Dear Customer,\nPKR 5,000.00 Debited from your A/C: 0847-1***2310 on 2-Nov-26 at 18:45:48 Bal: Reply with AB 021111225111"),
    )
  }

  @Test fun alfalahQrTransfer() {
    assertEquals(
      alfalah(Direction.OUT, 249000, "Test Shop", "FT26315ABCDEFGH1"),
      BankParser.parse("PKR 2490 has been transferred to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 at 12:30 via QR Tx ID FT26315ABCDEFGH1"),
    )
  }

  @Test fun alfalahRaastPaid() {
    assertEquals(
      alfalah(Direction.OUT, 249000, "Test Shop", "FT26315ABCDEFGH1"),
      BankParser.parse("PKR 2,490.00 paid to Test Shop from your BAFL A/C *2310 on 11-Nov-2026 12:32 via RAAST Tx FT26315ABCDEFGH1"),
    )
  }

  @Test fun alfalahSentWithFeeKeepsTheBankTagAndSkipsTheFee() {
    assertEquals(
      alfalah(Direction.OUT, 150000, "Some Person TMB", "FT26307ZZZZZZZZZ"),
      BankParser.parse("PKR 1,500.00 sent to Some Person TMB from your BAF A/C **2310 on 3-Nov-26 10:15:22 with Fee PKR 5.00 via FT Tx ID FT26307ZZZZZZZZZ"),
    )
  }

  @Test fun alfalahSentDropsTheMaskedIban() {
    assertEquals(
      alfalah(Direction.OUT, 30000, "Some Person", "FT26309YYYYYYYYY"),
      BankParser.parse("PKR 300 sent to Some Person PK***1234 from your BAF A/C *2310 on 5-Nov-26 09:10 Tx ID FT26309YYYYYYYYY"),
    )
  }

  @Test fun alfalahBillPaymentDropsTheConsumerId() {
    assertEquals(
      alfalah(Direction.OUT, 389700, "NTEL", "FT26308XXXXXXXX1"),
      BankParser.parse("PKR 3,897.00 Paid to NTEL Consumer ID 123456 from your BAF A/C **2310 on 4-Nov-26 11:11:11 via UBPS Tx ID FT26308XXXXXXXX1"),
    )
  }

  @Test fun alfalahReceivedFromAccount() {
    assertEquals(
      alfalah(Direction.IN, 5000000, "Some Person BAF", "FT26310WWWWWWWWW"),
      BankParser.parse("PKR 50,000.00 received from Some Person BAF in your BAF A/C **2310 on 6-Nov-26 14:00:00 via FT Tx ID FT26310WWWWWWWWW"),
    )
  }

  @Test fun alfalahReceivedViaRaastId() {
    assertEquals(
      alfalah(Direction.IN, 100000, "Some Person MUCBPKKKRTG", "FT26312VVVVVVVVV"),
      BankParser.parse("PKR 1000 received from Some Person MUCBPKKKRTG in your BAF A/C *2310 via your Raast ID on 08-11-26 at 12:00 Tx ID FT26312VVVVVVVVV"),
    )
  }

  private val sent = "PKR 300 sent to Some Person from your BAF A/C *2310 on 5-Nov-26 09:10 "

  // "Txn ID FT..." is not the plan's "Tx ID": the money still parses, the id is null (never "n").
  @Test fun txnIdWordingGivesNoIdRatherThanTheLetterN() {
    val p = BankParser.parse(sent + "Txn ID FT26315ABCDEFGH1")!!
    assertEquals(30000, p.amountMinor)
    assertNull(p.txId)
  }

  @Test fun txnWithoutAnIdReturnsNull() {
    assertNull(BankParser.parse(sent + "via Tx ID")!!.txId)
    assertNull(BankParser.parse(sent + "via Txn")!!.txId)
  }

  @Test fun alfalahOtpTextIsNotMoney() {
    assertNull(BankParser.parse("Your OTP for transferring PKR 5,000.00 to Some Person from your BAF A/C **2310 is 123456"))
  }

  @Test fun alfalahOffersAreNotMoney() {
    assertNull(BankParser.parse("Dear Customer, PKR 500 has been transferred to your wallet as cashback. Offer valid till 30-Nov-26"))
  }
}
