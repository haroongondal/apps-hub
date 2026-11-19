package expo.modules.designmedia.android

import expo.modules.designmedia.core.ImagePlan

// Lossless re-pack of a still: PNG is re-packed, JPEG loses only its metadata. Runs on a worker thread like the other runners.
object ImageRunner {
  private const val TOO_LARGE = "This image is too large to compress on the phone."
  private const val COULDNT = "Couldn't compress this image."

  fun start(req: Request, done: (Outcome) -> Unit): Runner {
    val plan = req.plan as ImagePlan
    return Worker(req.handler, done) { _ ->
      try {
        val saved = Images.compress(req.context, req.input, plan.format, req.out)
        Outcome.Written(note = "${(saved * 100).toInt()}% smaller")
      } catch (e: OutOfMemoryError) {
        Outcome.Failed(e.toString(), TOO_LARGE)
      } catch (e: IllegalArgumentException) {
        // Images throws only sentences written for people (e.g. "Couldn't open this image."); anything else stays off screen.
        Outcome.Failed(e.toString(), e.message ?: COULDNT)
      } catch (e: Exception) {
        Outcome.Failed(e.toString(), COULDNT)
      }
    }.start()
  }
}
