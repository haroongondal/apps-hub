package expo.modules.pdfscan.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.pdfscan.core.Detection
import expo.modules.pdfscan.core.DetectorConfig
import expo.modules.pdfscan.core.Luma
import expo.modules.pdfscan.core.QuadDetector
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

fun asFile(s: String): File = if (s.startsWith("file:")) File(Uri.parse(s).path ?: s) else File(s)

fun existingFile(s: String): File {
  val f = asFile(s)
  if (!f.isFile) throw CodedException("not_found", "The file ${f.path} doesn't exist.", null)
  return f
}

fun writeAtomically(dest: File, write: (OutputStream) -> Boolean) {
  dest.parentFile?.mkdirs()
  val tmp = File(dest.parentFile, dest.name + ".tmp")
  val ok = runCatching { FileOutputStream(tmp).use(write) }.getOrDefault(false)
  if (!ok || !tmp.renameTo(dest)) {
    tmp.delete()
    throw CodedException("save_failed", "${dest.name} couldn't be written. Free some space and try again.", null)
  }
}

// compress() reports a failed write (a full disk) only through its return value.
fun writeJpeg(bitmap: Bitmap, dest: File, quality: Int) = writeAtomically(dest) { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }

object ImageImport {
  const val MAX_SIDE = 3000
  private const val DETECT_SIDE = 640

  fun importUpright(src: File, dest: File, config: DetectorConfig = DetectorConfig()): Triple<Int, Int, Detection?> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(src.absolutePath, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
    val decoded = BitmapFactory.decodeFile(src.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw CodedException("decode_failed", "${src.name} isn't an image this phone can read.", null)
    val matrix = Matrix()
    when (ExifInterface(src.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
    }
    val scale = min(1f, MAX_SIDE.toFloat() / max(decoded.width, decoded.height))
    if (scale < 1f) matrix.preScale(scale, scale)
    val upright = if (matrix.isIdentity) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (upright !== decoded) decoded.recycle()
    try {
      writeJpeg(upright, dest, 90)
      return Triple(upright.width, upright.height, detectOn(upright, config))
    } finally {
      upright.recycle()
    }
  }

  fun detectFile(src: File, config: DetectorConfig = DetectorConfig()): Detection? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(src.absolutePath, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= DETECT_SIDE) sample *= 2
    val bitmap = BitmapFactory.decodeFile(src.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw CodedException("decode_failed", "${src.name} isn't an image this phone can read.", null)
    try {
      return detectOn(bitmap, config)
    } finally {
      bitmap.recycle()
    }
  }

  fun detectOn(bitmap: Bitmap, config: DetectorConfig = DetectorConfig()): Detection? {
    val s = min(1f, DETECT_SIDE.toFloat() / max(bitmap.width, bitmap.height))
    val small = Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * s).roundToInt()), max(1, (bitmap.height * s).roundToInt()), true)
    val px = IntArray(small.width * small.height)
    small.getPixels(px, 0, small.width, 0, 0, small.width, small.height)
    val luma = ByteArray(px.size) { i ->
      val c = px[i]
      ((Color.red(c) * 77 + Color.green(c) * 150 + Color.blue(c) * 29) shr 8).toByte()
    }
    val det = QuadDetector(config).detect(Luma(luma, small.width, small.height))
    if (small !== bitmap) small.recycle()
    return det
  }
}
