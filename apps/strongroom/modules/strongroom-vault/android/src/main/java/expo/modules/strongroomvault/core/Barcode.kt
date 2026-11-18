package expo.modules.strongroomvault.core

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter
import com.google.zxing.WriterException
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** Turns a pass code into a bit matrix. Pure (no android.*), so JVM tests can decode it back. */
sealed class BarcodeResult {
  class Ok(val matrix: BitMatrix) : BarcodeResult()
  /** [message] is plain words a screen can show as is. */
  class Error(val message: String) : BarcodeResult()
}

object Barcode {
  fun encodeMatrix(code: String, format: String): BarcodeResult {
    if (code.isEmpty()) return BarcodeResult.Error("Enter the code first")
    return when (format) {
      "qr" -> write(code, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2, EncodeHintType.CHARACTER_SET to "UTF-8"), "That code is too long for a QR code")
      "code128" ->
        if (code.any { it.code !in 32..126 }) BarcodeResult.Error("Code 128 supports printable ASCII only")
        else write(code, BarcodeFormat.CODE_128, 0, 1, mapOf(EncodeHintType.MARGIN to 10), "That code is too long for Code 128")
      "ean13" -> {
        if (code.length !in 12..13 || code.any { it !in '0'..'9' }) BarcodeResult.Error("EAN-13 needs 12 or 13 digits")
        else if (code.length == 13 && checkDigit(code.take(12)) != code[12]) BarcodeResult.Error("The last digit of this EAN-13 code is wrong")
        else write(code, BarcodeFormat.EAN_13, 0, 1, mapOf(EncodeHintType.MARGIN to 10), "That code is not a valid EAN-13")
      }
      else -> BarcodeResult.Error("Unknown barcode format")
    }
  }

  private fun checkDigit(twelve: String): Char {
    val sum = twelve.withIndex().sumOf { (i, c) -> (c - '0') * if (i % 2 == 0) 1 else 3 }
    return '0' + (10 - sum % 10) % 10
  }

  // Width/height 0 asks zxing for the smallest matrix; 1 row high for 1-D formats (the renderer stretches it).
  private fun write(code: String, f: BarcodeFormat, w: Int, h: Int, hints: Map<EncodeHintType, Any>, tooLong: String): BarcodeResult =
    try {
      BarcodeResult.Ok(MultiFormatWriter().encode(code, f, w, h, hints))
    } catch (e: WriterException) {
      BarcodeResult.Error(tooLong)
    } catch (e: IllegalArgumentException) {
      BarcodeResult.Error(tooLong)
    }
}
