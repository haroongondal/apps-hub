package expo.modules.designmedia.android

import expo.modules.designmedia.core.ImageOptimizer
import expo.modules.designmedia.core.ImagePlan
import expo.modules.designmedia.core.LeftAloneException

object ImageRunner {
  const val NO_GAIN = "no gain"
  const val LEFT_ALONE = "left alone"

  fun start(req: Request, done: (Outcome) -> Unit): Runner =
    Worker(req.handler, done) { worker -> shrink(req, req.plan as ImagePlan, worker) }.start()

  private fun shrink(req: Request, plan: ImagePlan, worker: Worker): Outcome {
    val src = requireNotNull(req.context.contentResolver.openInputStream(req.input)) { "input not readable" }.use { it.readBytes() }
    worker.check()
    val smaller = try {
      ImageOptimizer.optimize(src, plan.format)
    } catch (e: LeftAloneException) {
      return Outcome.Failed(LEFT_ALONE)
    } catch (e: OutOfMemoryError) {
      return Outcome.Failed("out of memory")
    } ?: return Outcome.Failed(NO_GAIN)
    worker.check()
    req.out.writeBytes(smaller)
    return Outcome.Written()
  }
}
