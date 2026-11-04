package expo.modules.designmedia.android

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import expo.modules.designmedia.core.FramePlan
import expo.modules.designmedia.core.microseconds
import java.io.FileOutputStream

object StillRunner {
  private const val JPEG_QUALITY = 95
  private const val STEP_BACK_US = 100_000L

  fun start(req: Request, source: Probe.Source, done: (Outcome) -> Unit): Runner =
    Worker(req.handler, done) { _ -> still(req, req.plan as FramePlan, source) }.start()

  private fun still(req: Request, plan: FramePlan, source: Probe.Source): Outcome {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(req.context, req.input)
      val wanted = minOf(microseconds(plan.timeS), microseconds(source.durationS))
      // A request at the very end can come back empty; the last tenth of a second always has a frame.
      val bitmap = retriever.getFrameAtTime(wanted, MediaMetadataRetriever.OPTION_CLOSEST)
        ?: retriever.getFrameAtTime((wanted - STEP_BACK_US).coerceAtLeast(0), MediaMetadataRetriever.OPTION_CLOSEST)
        ?: return Outcome.Failed("no frame at ${plan.timeS}")
      val ok = FileOutputStream(req.out).use { out ->
        bitmap.compress(if (plan.format == "jpg") Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, JPEG_QUALITY, out)
      }
      bitmap.recycle()
      return if (ok) Outcome.Written() else Outcome.Failed("compress failed")
    } finally {
      retriever.release()
    }
  }
}
