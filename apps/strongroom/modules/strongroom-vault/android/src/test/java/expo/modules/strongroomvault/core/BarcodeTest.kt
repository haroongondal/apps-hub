package expo.modules.strongroomvault.core

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.EncodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.common.BitMatrix
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BarcodeTest {
  // Scales modules up the way a screen would show them and decodes with zxing. No padding of its own: the matrix must carry its quiet zone.
  private fun decode(m: BitMatrix): String {
    val s = 4
    val w = m.width * s
    val h = if (m.height == 1) 60 else m.height * s
    val src = object : LuminanceSource(w, h) {
      override fun getRow(y: Int, row: ByteArray?): ByteArray {
        val r = row ?: ByteArray(width)
        for (x in 0 until width) r[x] = pixel(x, y)
        return r
      }
      override fun getMatrix(): ByteArray = ByteArray(width * height).also { for (y in 0 until height) for (x in 0 until width) it[y * width + x] = pixel(x, y) }
      private fun pixel(x: Int, y: Int): Byte = if (m.get(x / s, if (m.height == 1) 0 else y / s)) 0 else 255.toByte()
      override fun isCropSupported() = false
    }
    return MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(src))).text
  }

  private fun leftQuiet(m: BitMatrix, y: Int = 0) = (0 until m.width).takeWhile { !m.get(it, y) }.size
  private fun rightQuiet(m: BitMatrix, y: Int = 0) = (m.width - 1 downTo 0).takeWhile { !m.get(it, y) }.size

  private fun ok(code: String, format: String) = (Barcode.encodeMatrix(code, format) as BarcodeResult.Ok).matrix
  private fun err(code: String, format: String) = (Barcode.encodeMatrix(code, format) as BarcodeResult.Error).message

  @Test fun qrRoundTrips() = assertEquals("https://example.com/p?id=42 ü", decode(ok("https://example.com/p?id=42 ü", "qr")))

  @Test fun code128RoundTrips() = assertEquals("AB-1234 xyz", decode(ok("AB-1234 xyz", "code128")))

  @Test fun ean13With13DigitsRoundTrips() = assertEquals("4006381333931", decode(ok("4006381333931", "ean13")))

  @Test fun ean13With12DigitsGetsTheCheckDigit() = assertEquals("4006381333931", decode(ok("400638133393", "ean13")))

  @Test fun emptyCodeIsRejected() = assertEquals("Enter the code first", err("", "qr"))

  @Test fun ean13RejectsBadLengthAndNonDigits() {
    assertEquals("EAN-13 needs 12 or 13 digits", err("12345", "ean13"))
    assertEquals("EAN-13 needs 12 or 13 digits", err("40063813339312", "ean13"))
    assertEquals("EAN-13 needs 12 or 13 digits", err("40063813339a", "ean13"))
  }

  @Test fun ean13RejectsBadCheckDigit() = assertTrue(err("4006381333932", "ean13").contains("last digit"))

  @Test fun code128RejectsNonAscii() = assertEquals("Code 128 supports printable ASCII only", err("café", "code128"))

  @Test fun qrRejectsOversizedCode() = assertEquals("That code is too long for a QR code", err("a".repeat(5000), "qr"))

  @Test fun unknownFormatIsRejected() = assertEquals("Unknown barcode format", err("1", "pdf417"))

  @Test fun oneDimensionalCodesCarryAtLeastTenModulesOfQuietZoneEachSide() {
    for ((code, format) in listOf("AB-1234 xyz" to "code128", "4006381333931" to "ean13")) {
      val m = ok(code, format)
      assertTrue("$format left", leftQuiet(m) >= 10)
      assertTrue("$format right", rightQuiet(m) >= 10)
    }
  }

  @Test fun qrCarriesFourModulesOfQuietZoneOnEverySide() {
    val m = ok("https://example.com/p?id=42", "qr")
    for (i in 0 until m.width) {
      assertTrue(leftQuiet(m, i) >= 4 && rightQuiet(m, i) >= 4)
      assertTrue((0 until 4).none { m.get(i, it) || m.get(i, m.height - 1 - it) })
    }
  }

  @Test fun code128IsCappedAtEightyCharacters() {
    assertTrue(Barcode.encodeMatrix("a".repeat(80), "code128") is BarcodeResult.Ok)
    assertEquals("That code is too long for Code 128", err("a".repeat(81), "code128"))
  }

  @Test fun aPlainAsciiQrHasNoUtf8EciHeaderButNonLatinTextStillRoundTrips() {
    val code = "https://example.com/p?id=42"
    val plain = QRCodeWriter().encode(code, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 4))
    assertEquals(plain, ok(code, "qr"))
    assertEquals("日本語 7", decode(ok("日本語 7", "qr")))
  }

  @Test fun pixelPlanNeverPassesTheBudgetEvenForTheLargestCodes() {
    val widest = ok("~".repeat(80), "code128")
    val qrs = listOf(widest.width to 1, 185 to 185, 117 to 1, 1 to 1)
    for ((w, h) in qrs) {
      val p = Barcode.pixelPlan(w, h, 100_000)
      assertTrue("$w x $h", p.widthPx <= Barcode.MAX_SIDE_PX && p.heightPx <= Barcode.MAX_SIDE_PX && p.widthPx.toLong() * p.heightPx <= Barcode.MAX_PIXELS)
    }
    assertEquals(4, Barcode.pixelPlan(100, 100, 400).scale)
    assertEquals(1, Barcode.pixelPlan(100, 100, 5).scale)
    assertThrows(IllegalArgumentException::class.java) { Barcode.pixelPlan(3000, 1, 100) }
  }
}
