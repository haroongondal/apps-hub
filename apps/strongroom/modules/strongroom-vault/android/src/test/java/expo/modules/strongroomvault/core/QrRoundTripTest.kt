package expo.modules.strongroomvault.core

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.EncodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.common.BitMatrix
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The scan screen's pipeline (DESIGN §15.4): zxing decodes the QR into the exact URI, then Otp parses it. */
class QrRoundTripTest {
  /** A QRCodeWriter's BitMatrix as a luminance source: black is dark, white is bright. */
  private class MatrixSource(private val m: BitMatrix) : LuminanceSource(m.width, m.height) {
    override fun getRow(y: Int, row: ByteArray?): ByteArray {
      val r = row ?: ByteArray(m.width)
      for (x in 0 until m.width) r[x] = if (m[x, y]) 0 else -1
      return r
    }

    override fun getMatrix(): ByteArray = ByteArray(m.width * m.height) { i -> if (m[i % m.width, i / m.width]) 0 else -1 }
  }

  /** What the camera sees the scan screen do: the QR on a site's page becomes its URI again. */
  private fun scan(raw: String): String {
    val matrix = QRCodeWriter().encode(raw, BarcodeFormat.QR_CODE, 400, 400, mapOf(EncodeHintType.MARGIN to 4))
    return QRCodeReader().decode(BinaryBitmap(HybridBinarizer(MatrixSource(matrix)))).text
  }

  @Test fun scannedQrParses() {
    val raw = "otpauth://totp/Acme:ana%40acme.example?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme"
    assertEquals(raw, scan(raw))
    val totp = Otp.parse(scan(raw))
    assertNotNull(totp)
    assertEquals("Acme", totp!!.issuer)
    assertEquals("ana@acme.example", totp.account)
    assertEquals(Otp.Digest.SHA1, totp.algorithm)
    assertEquals(6, totp.digits)
    assertEquals(30, totp.period)
  }

  @Test fun scannedQrCarriesTheWholeSecret() {
    // Percent-encoded label parts and non-default parameters survive the round trip.
    val raw = "otpauth://totp/Deep%20Blue:dive%2Bsea%3F%3F?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPU&algorithm=SHA256&digits=8&period=60"
    assertEquals(raw, scan(raw))
    val totp = Otp.parse(raw)!!
    assertEquals("Deep Blue", totp.issuer)
    assertEquals("dive+sea??", totp.account)
    assertEquals(Otp.Digest.SHA256, totp.algorithm)
    assertEquals(8, totp.digits)
    assertEquals(60, totp.period)
  }

  @Test fun aForeignQrIsRefused() {
    val raw = "https://example.com/signup"
    assertEquals(raw, scan(raw))
    assertNull(Otp.parse(raw))
    assertTrue(Otp.refusal(raw)!!.contains("not an authenticator code"))
  }
}
