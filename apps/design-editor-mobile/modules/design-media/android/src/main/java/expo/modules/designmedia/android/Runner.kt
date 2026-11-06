package expo.modules.designmedia.android

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import expo.modules.designmedia.core.Plan
import java.io.File
import java.util.concurrent.CancellationException

// One tool's work on one attempt. `done` always runs on the service's handler thread, exactly once unless cancelled.
interface Runner {
  fun progress(): Double?

  fun cancel()
}

// `detail` goes to logcat, never to the screen. `label` replaces the plan's default output label (audio tracks).
sealed interface Outcome {
  data class Written(val label: String? = null) : Outcome
  data class Failed(val detail: String) : Outcome
}

class Request(
  val context: Context, val looper: Looper, val handler: Handler, val plan: Plan, val input: Uri, val out: File, val cbr: Boolean,
)

// Runs blocking work on its own thread and posts the outcome to the service's handler.
class Worker(private val handler: Handler, private val done: (Outcome) -> Unit, private val work: (Worker) -> Outcome) : Runner {
  @Volatile private var fraction: Double? = null
  @Volatile var isCancelled = false
    private set

  fun start(): Worker {
    Thread({
      val outcome = try {
        work(this)
      } catch (e: CancellationException) {
        Outcome.Failed("cancelled")
      } catch (e: Throwable) {
        Outcome.Failed(e.toString())
      }
      handler.post { done(outcome) }
    }, "design-media-worker").start()
    return this
  }

  fun report(value: Double) {
    fraction = value.coerceIn(0.0, 1.0)
  }

  fun check() {
    if (isCancelled) throw CancellationException()
  }

  override fun progress() = fraction

  override fun cancel() {
    isCancelled = true
  }
}
