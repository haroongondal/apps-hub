package expo.modules.strongroomvault.android

import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import com.google.zxing.common.BitMatrix
import expo.modules.strongroomvault.core.Barcode
import java.io.ByteArrayOutputStream

/** Draws a pass barcode as a PNG: black on white always, so scanners work even in dark mode. */
object PassImage {
  fun png(matrix: BitMatrix, widthPx: Int): ByteArray {
    val plan = Barcode.pixelPlan(matrix.width, matrix.height, widthPx)
    val scale = plan.scale
    val bmp = Bitmap.createBitmap(plan.widthPx, plan.heightPx, Bitmap.Config.ARGB_8888)
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
