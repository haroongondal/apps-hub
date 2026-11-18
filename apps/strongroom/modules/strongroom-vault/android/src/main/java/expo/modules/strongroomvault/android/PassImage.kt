package expo.modules.strongroomvault.android

import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import com.google.zxing.common.BitMatrix
import java.io.ByteArrayOutputStream

/** Draws a pass barcode as a PNG: black on white always, so scanners work even in dark mode. */
object PassImage {
  /** 1-D codes come out one row high, so they are stretched to a third of their width. */
  fun png(matrix: BitMatrix, widthPx: Int): ByteArray {
    val scale = maxOf(1, widthPx / matrix.width)
    val heightModules = if (matrix.height == 1) matrix.width / 3 else matrix.height
    val bmp = Bitmap.createBitmap(matrix.width * scale, heightModules * scale, Bitmap.Config.ARGB_8888)
    val row = IntArray(bmp.width)
    for (y in 0 until bmp.height) {
      val my = if (matrix.height == 1) 0 else y / scale
      for (x in row.indices) row[x] = if (matrix.get(x / scale, my)) Color.BLACK else Color.WHITE
      bmp.setPixels(row, 0, bmp.width, 0, y, bmp.width, 1)
    }
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
    bmp.recycle()
    return out.toByteArray()
  }

  fun dataUri(matrix: BitMatrix, widthPx: Int): String =
    "data:image/png;base64," + Base64.encodeToString(png(matrix, widthPx), Base64.NO_WRAP)
}
