package expo.modules.strongroomvault.core

import com.google.zxing.BinaryBitmap
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.common.BitMatrix
import com.google.zxing.common.HybridBinarizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BarcodeTest {
  // Scales modules up and pads a quiet zone, the way a screen would show them, then decodes with zxing.
  private fun decode(m: BitMatrix): String {
    val s = 4
    val pad = 40
    val h = if (m.height == 1) 60 else m.height * s
    val w = m.width * s + 2 * pad
    val src = object : LuminanceSource(w, h + 2 * pad) {
      override fun getRow(y: Int, row: ByteArray?): ByteArray {
        val r = row ?: ByteArray(width)
        for (x in 0 until width) r[x] = pixel(x, y)
        return r
      }
      override fun getMatrix(): ByteArray = ByteArray(width * height).also { for (y in 0 until height) for (x in 0 until width) it[y * width + x] = pixel(x, y) }
      private fun pixel(x: Int, y: Int): Byte {
        val mx = (x - pad) / s
        val my = if (m.height == 1) 0 else (y - pad) / s
        val inside = x >= pad && y >= pad && mx < m.width && y < pad + h
        return if (inside && m.get(mx, my)) 0 else 255.toByte()
      }
      override fun isCropSupported() = false
    }
    return MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(src))).text
  }

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
}
