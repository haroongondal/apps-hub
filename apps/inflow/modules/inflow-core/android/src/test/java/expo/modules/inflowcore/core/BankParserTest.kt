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

  // The owner's two bank emails, verbatim (numbers changed by the owner).
  private val ublEmail = """Dear HAROON MUKHTAR ,

You paid PKR. 7,000.00 to JAYISHA NOOR via Raast.

Here are the details:

Account Title: HAROON MUKHTAR
Account Details: Pwd Colony Road Branch, Islamabad - 28*****33
Date: 23-Oct-2026
Time: 06:53:20 PM
Transaction ID: 1430551744
Transaction Type: Inter Bank Funds Transfer Raast
"""

  private val alfalahEmail = """Transaction Successful

Thursday, November 12, 2026 | 4:19 PM

Ref# FT263160G6MC4S12

Account Title

HAROON MUKHTAR

Account/IBAN

*****2310

Purpose of Payment

Others

Transaction Type

POS

Tax/Charges

PKR 0.0000/-

Orbits

-

Available Balance

Type 'AB' & send SMS to 8287

Amount

PKR 1,700.00/-

Get exclusive updates, exciting offers, and the latest features\u2014right at your fingertips!
Join our WhatsApp Channel today and stay connected:

Join WhatsApp Channel
WhatsApp QR Code
For queries or assistance, please call/Whatsapp: 021111225111
"""

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
}
