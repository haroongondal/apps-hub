package expo.modules.designmedia.android

import android.content.Context
import android.net.Uri
import expo.modules.designmedia.core.ImageOptimizer
import java.io.File

object Images {
  const val NO_GAIN = "This image is already as small as lossless compression can make it."

  // Reads the original and writes a new file; the original is opened read-only. Returns the saved fraction, or throws.
  fun compress(context: Context, uri: Uri, format: String, out: File): Double {
    val src = requireNotNull(context.contentResolver.openInputStream(uri)) { "Couldn't open this image." }.use { it.readBytes() }
    val smaller = ImageOptimizer.optimize(src, format) ?: throw IllegalArgumentException(NO_GAIN)
    out.writeBytes(smaller)
    return 1.0 - smaller.size.toDouble() / src.size
  }
}
