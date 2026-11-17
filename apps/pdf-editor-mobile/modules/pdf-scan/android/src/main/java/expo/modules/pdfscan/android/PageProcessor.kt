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
import expo.modules.pdfscan.core.BitPack
import expo.modules.pdfscan.core.Filters
import expo.modules.pdfscan.core.PageGeometry
import java.io.File
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream

class ProcessRequest : Record {
  @Field val src: String = ""
  @Field val quad: List<Double>? = null
  @Field val rotation: Int = 0
  @Field val filter: String = "auto"
  @Field val out: String = ""
  @Field val maxLongSide: Int = 2339
}

// SPEC §7.5.
object PageProcessor {
  private const val BITS_LONG_SIDE = 3508
  private const val BITS_MAX_SCALE = 1.5
  private val FILTERS = setOf("original", "auto", "gray", "bw")

  fun process(req: ProcessRequest): Map<String, Any?> {
    val quad = req.quad?.toDoubleArray() ?: PageGeometry.fullFrameQuad()
    if (!PageGeometry.validateQuad(quad)) throw CodedException("invalid_quad", "The page corners must be 8 numbers from 0 to 1 that form a convex shape.", null)
    require(req.rotation in setOf(0, 90, 180, 270)) { "rotation must be 0, 90, 180 or 270, not ${req.rotation}" }
    require(req.filter in FILTERS) { "unknown filter ${req.filter}" }
    require(req.out.isNotBlank() && req.maxLongSide > 0) { "out and maxLongSide are required" }
    val src = existingFile(req.src)
    val out = asFile(req.out)
    val bw = req.filter == "bw"
    var source: Bitmap? = null
    var page: Bitmap? = null
    var display: Bitmap? = null
    try {
      val decoded = BitmapFactory.decodeFile(src.absolutePath, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 })
        ?: throw CodedException("decode_failed", "${src.name} isn't an image this phone can read.", null)
      source = decoded
      val px = DoubleArray(8) { i -> quad[i] * if (i % 2 == 0) decoded.width else decoded.height }
      val (jw, jh) = PageGeometry.outputSize(px, req.rotation, req.maxLongSide)
      val (w, h) = if (bw) PageGeometry.outputSize(px, req.rotation, BITS_LONG_SIDE, BITS_MAX_SCALE) else jw to jh
      page = warp(decoded, px, req.rotation, w, h)
      decoded.recycle()
      var bits: ByteArray? = null
      if (req.filter != "original") {
        val argb = IntArray(w * h)
        page.getPixels(argb, 0, w, 0, 0, w, h)
        when (req.filter) {
          "auto" -> Filters.magic(argb, w, h)
          "gray" -> Filters.gray(argb, w, h)
          else -> bits = Filters.sauvola(argb, w, h)
        }
        page.setPixels(argb, 0, w, 0, 0, w, h)
      }
      val jpg = File(out.path + ".jpg")
      var bitsFile: File? = null
      if (bits != null) {
        bitsFile = File(out.path + ".bits")
        val packed = BitPack.pack(bits, w, h)
        writeAtomically(bitsFile) { stream ->
          val deflater = Deflater(9)
          try {
            DeflaterOutputStream(stream, deflater).apply { write(packed); finish() }
          } finally {
            deflater.end()
          }
          true
        }
        display = if (w == jw && h == jh) page else Bitmap.createScaledBitmap(page, jw, jh, true)
        writeJpeg(display, jpg, 70)
      } else {
        writeJpeg(page, jpg, 80)
      }
      return mapOf(
        "jpg" to jpg.path, "width" to jw, "height" to jh,
        "bits" to bitsFile?.path, "bitsWidth" to if (bw) w else null, "bitsHeight" to if (bw) h else null,
      )
    } catch (e: OutOfMemoryError) {
      throw CodedException("out_of_memory", "The phone ran out of memory processing this page.", e)
    } finally {
      source?.recycle()
      if (display !== page) display?.recycle()
      page?.recycle()
    }
  }

  private fun warp(source: Bitmap, quadPx: DoubleArray, rotation: Int, w: Int, h: Int): Bitmap {
    val from = PageGeometry.rotatedQuad(quadPx, rotation).map { it.toFloat() }.toFloatArray()
    val to = floatArrayOf(0f, 0f, w.toFloat(), 0f, w.toFloat(), h.toFloat(), 0f, h.toFloat())
    val matrix = Matrix()
    if (!matrix.setPolyToPoly(from, 0, to, 0, 4)) throw CodedException("invalid_quad", "These page corners can't be straightened.", null)
    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG))
    return out
  }
}
