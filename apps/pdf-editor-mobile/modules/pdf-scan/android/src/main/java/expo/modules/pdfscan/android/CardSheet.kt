package expo.modules.pdfscan.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.pdfscan.core.SheetLayout
import java.io.File

class SheetRequest : Record {
  @Field val front: String = ""
  @Field val back: String? = null
  @Field val out: String = ""
}

object CardSheet {
  fun compose(req: SheetRequest): Map<String, Any?> {
    require(req.out.isNotBlank()) { "out is required" }
    val cards = listOfNotNull(existingFile(req.front), req.back?.let(::existingFile))
    val jpg = File(asFile(req.out).path + ".jpg")
    var sheet: Bitmap? = null
    try {
      val s = Bitmap.createBitmap(SheetLayout.WIDTH, SheetLayout.HEIGHT, Bitmap.Config.ARGB_8888)
      sheet = s
      val canvas = Canvas(s)
      canvas.drawColor(Color.WHITE)
      val paint = Paint(Paint.FILTER_BITMAP_FLAG)
      cards.zip(SheetLayout.cardRects(cards.size == 2)).forEach { (file, rect) ->
        val card = BitmapFactory.decodeFile(file.absolutePath)
          ?: throw CodedException("decode_failed", "${file.name} isn't an image this phone can read.", null)
        try {
          val (turn, dst) = SheetLayout.fit(card.width, card.height, rect)
          val w = card.width.toFloat()
          val h = card.height.toFloat()
          val m = Matrix()
          if (turn) {
            m.setRotate(90f)
            m.postTranslate(h, 0f)
            m.postScale((dst[2] - dst[0]) / h, (dst[3] - dst[1]) / w)
          } else {
            m.setScale((dst[2] - dst[0]) / w, (dst[3] - dst[1]) / h)
          }
          m.postTranslate(dst[0].toFloat(), dst[1].toFloat())
          canvas.drawBitmap(card, m, paint)
        } finally {
          card.recycle()
        }
      }
      writeJpeg(s, jpg, 85)
      return mapOf("jpg" to jpg.path, "width" to SheetLayout.WIDTH, "height" to SheetLayout.HEIGHT)
    } catch (e: OutOfMemoryError) {
      throw CodedException("out_of_memory", "The phone ran out of memory making the card sheet.", e)
    } finally {
      sheet?.recycle()
    }
  }
}
