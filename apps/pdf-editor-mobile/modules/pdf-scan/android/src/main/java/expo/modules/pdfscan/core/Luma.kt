package expo.modules.pdfscan.core

/** An 8-bit luma plane; the camera's Y plane can have a row stride wider than the image. */
class Luma(val data: ByteArray, val width: Int, val height: Int, val rowStride: Int = width) {
  init {
    require(width > 0 && height > 0 && rowStride >= width && data.size >= rowStride * (height - 1) + width) {
      "bad luma plane ${width}x$height stride $rowStride size ${data.size}"
    }
  }

  operator fun get(x: Int, y: Int): Int = data[y * rowStride + x].toInt() and 0xFF
}
