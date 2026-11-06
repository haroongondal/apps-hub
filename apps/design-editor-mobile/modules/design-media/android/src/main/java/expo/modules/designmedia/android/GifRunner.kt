package expo.modules.designmedia.android

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import expo.modules.designmedia.core.GifPlan
import expo.modules.designmedia.core.GifWriter
import expo.modules.designmedia.core.microseconds
import expo.modules.designmedia.core.scaledHeight
import java.io.BufferedOutputStream
import java.io.FileOutputStream

// MediaMetadataRetriever stands in for Media3's FrameExtractor: media3-inspector 1.11.1 only carries
// MediaExtractorCompat and MetadataRetriever (the extractor moved to a separate artifact the owner hasn't approved).
object GifRunner {
  fun start(req: Request, source: Probe.Source, done: (Outcome) -> Unit): Runner =
    Worker(req.handler, done) { w -> encode(req, req.plan as GifPlan, source, w) }.start()

  private fun encode(req: Request, plan: GifPlan, source: Probe.Source, w: Worker): Outcome {
    if (source.width <= 0 || source.height <= 0) return Outcome.Failed("no picture track")
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(req.context, req.input)
      val askHeight = scaledHeight(source.width, source.height, plan.width)
      val lastUs = microseconds(source.durationS)
      fun grab(index: Int, size: Pair<Int, Int>?): Bitmap? {
        val us = minOf(microseconds(GifWriter.frameTimeS(plan.startS, plan.fps, index)), lastUs)
        val raw = retriever.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST, plan.width, askHeight) ?: return null
        if (size == null || (raw.width == size.first && raw.height == size.second)) return raw
        return Bitmap.createScaledBitmap(raw, size.first, size.second, true).also { raw.recycle() }
      }

      val first = grab(0, null) ?: return Outcome.Failed("no frame at the start")
      val width = first.width
      val height = first.height
      first.recycle()
      val count = GifWriter.frameCount(plan.startS, plan.endS, plan.fps)
      BufferedOutputStream(FileOutputStream(req.out)).use { stream ->
        GifWriter.write(
          stream, width, height, plan.fps, count,
          frame = { i, rgb ->
            val bitmap = grab(i, width to height)
            if (bitmap != null) {
              bitmap.getPixels(rgb, 0, width, 0, 0, width, height)
              bitmap.recycle()
              for (p in rgb.indices) rgb[p] = rgb[p] and 0xFFFFFF
            }
          },
          progress = w::report,
          cancelled = { w.isCancelled },
        )
      }
      return Outcome.Written()
    } finally {
      retriever.release()
    }
  }
}
