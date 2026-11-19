package expo.modules.textocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import java.io.InputStream

const val MAX_SIDE = 3000
const val MIN_LINE_CONFIDENCE = 40
private const val ENG_SIZE = 4113088L // bytes of assets/tessdata/eng.traineddata; build.gradle checks its sha256

/** Smallest power of two that brings the longest side to MAX_SIDE or less. */
fun sampleSizeFor(width: Int, height: Int, maxSide: Int = MAX_SIDE): Int {
  var s = 1
  while (maxOf(width, height) / s > maxSide) s *= 2
  return s
}

/** A line is kept when it has text and Tesseract is at least MIN_LINE_CONFIDENCE sure of it. */
fun keepLine(text: String?, confidence: Float) = !text.isNullOrBlank() && confidence >= MIN_LINE_CONFIDENCE

/** Matrix that turns an EXIF orientation into an upright picture, or null when it is already upright. */
fun exifMatrix(orientation: Int): Matrix? {
  val m = Matrix()
  when (orientation) {
    ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
    ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
    ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
    ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
    ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
    ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
    ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
    else -> return null
  }
  return m
}

/** Reads a picture at a size Tesseract can take, upright. `open` is called once per pass (bounds, pixels, EXIF). */
fun decodeUpright(open: () -> InputStream?): Bitmap {
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  open()?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: throw IllegalArgumentException("Cannot open the picture")
  if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("The data is not a picture Android can read")
  val opts = BitmapFactory.Options().apply { inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight) }
  val bmp = open()?.use { BitmapFactory.decodeStream(it, null, opts) } ?: throw IllegalArgumentException("Cannot decode the picture")
  val orientation = open()?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } ?: ExifInterface.ORIENTATION_NORMAL
  val m = exifMatrix(orientation) ?: return bmp
  val upright = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
  if (upright !== bmp) bmp.recycle()
  return upright
}

private fun installTessdata(context: Context): File {
  val dir = File(context.filesDir, "tessdata").apply { mkdirs() }
  val target = File(dir, "eng.traineddata")
  if (target.length() != ENG_SIZE) {
    val tmp = File(dir, "eng.traineddata.tmp")
    context.assets.open("tessdata/eng.traineddata").use { i -> tmp.outputStream().use { i.copyTo(it) } }
    if (!tmp.renameTo(target)) throw IllegalStateException("Cannot install the English text model")
  }
  return context.filesDir
}

/** One Tesseract run per call; TessBaseAPI is not thread-safe, so it never outlives the call. */
fun recognize(context: Context, open: () -> InputStream?): Map<String, Any> {
  val dataPath = installTessdata(context).absolutePath
  val bmp = decodeUpright(open)
  val api = TessBaseAPI()
  try {
    if (!api.init(dataPath, "eng")) throw IllegalStateException("Cannot start the text reader")
    api.pageSegMode = TessBaseAPI.PageSegMode.PSM_AUTO
    api.setImage(bmp)
    api.getUTF8Text() // runs the recognition; the iterator below reads its result
    val lines = ArrayList<Map<String, Any>>()
    val it = api.resultIterator
    if (it != null) {
      val level = TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE
      it.begin()
      do {
        val text = it.getUTF8Text(level)?.trim()
        if (keepLine(text, it.confidence(level))) {
          val r = it.getBoundingRect(level)
          lines.add(mapOf("text" to text!!, "left" to r.left, "top" to r.top, "right" to r.right, "bottom" to r.bottom))
        }
      } while (it.next(level))
      it.delete()
    }
    return mapOf("width" to bmp.width, "height" to bmp.height, "lines" to lines)
  } finally {
    api.recycle()
    bmp.recycle()
  }
}
