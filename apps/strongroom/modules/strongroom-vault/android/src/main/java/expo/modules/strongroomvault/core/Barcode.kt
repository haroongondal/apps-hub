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

/** What [PassImage] draws: whole pixels per module and the resulting bitmap size. */
class PixelPlan(val scale: Int, val widthPx: Int, val heightPx: Int)

object Barcode {
  // zxing's MARGIN is the TOTAL side margin for 1-D codes (11 modules a side, the scanner minimum) and the margin per side for QR (4, the standard).
  const val ONE_D_QUIET_MODULES = 22
  const val QR_QUIET_MODULES = 4
  const val MAX_CODE128 = 80
  const val MAX_SIDE_PX = 2048
  const val MAX_PIXELS = 4_000_000L

  /** 1-D codes come out one row high and are drawn a third as tall as wide. The scale never lets the bitmap pass the pixel budget. */
  fun pixelPlan(matrixWidth: Int, matrixHeight: Int, wantedWidthPx: Int): PixelPlan {
    val hModules = if (matrixHeight == 1) maxOf(1, matrixWidth / 3) else matrixHeight
    val fit = minOf(MAX_SIDE_PX / matrixWidth, MAX_SIDE_PX / hModules, Math.sqrt(MAX_PIXELS.toDouble() / (matrixWidth.toLong() * hModules)).toInt())
    require(fit >= 1) { "That barcode is too big to draw." }
    val scale = minOf(fit, maxOf(1, wantedWidthPx / matrixWidth))
    return PixelPlan(scale, matrixWidth * scale, hModules * scale)
  }

  fun encodeMatrix(code: String, format: String): BarcodeResult {
    if (code.isEmpty()) return BarcodeResult.Error("Enter the code first")
    return when (format) {
      "qr" -> {
        val hints = mutableMapOf<EncodeHintType, Any>(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to QR_QUIET_MODULES)
        // ASCII gets no ECI header (plain scanners misread it); anything else gets UTF-8 with the ECI, because zxing guesses Shift_JIS for Latin-1 bytes without one.
        if (code.any { it.code > 0x7F }) hints[EncodeHintType.CHARACTER_SET] = "UTF-8"
        write(code, BarcodeFormat.QR_CODE, 0, 0, hints, "That code is too long for a QR code")
      }
      "code128" ->
        if (code.any { it.code !in 32..126 }) BarcodeResult.Error("Code 128 supports printable ASCII only")
        else if (code.length > MAX_CODE128) BarcodeResult.Error("That code is too long for Code 128")
        else write(code, BarcodeFormat.CODE_128, 0, 1, mapOf(EncodeHintType.MARGIN to ONE_D_QUIET_MODULES), "That code is too long for Code 128")
      "ean13" -> {
        if (code.length !in 12..13 || code.any { it !in '0'..'9' }) BarcodeResult.Error("EAN-13 needs 12 or 13 digits")
        else if (code.length == 13 && checkDigit(code.take(12)) != code[12]) BarcodeResult.Error("The last digit of this EAN-13 code is wrong")
        else write(code, BarcodeFormat.EAN_13, 0, 1, mapOf(EncodeHintType.MARGIN to ONE_D_QUIET_MODULES), "That code is not a valid EAN-13")
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
