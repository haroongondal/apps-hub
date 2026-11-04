package expo.modules.designmedia

import android.net.Uri
import expo.modules.designmedia.android.Access
import expo.modules.designmedia.android.CodecReport
import expo.modules.designmedia.android.DesignSaves
import expo.modules.designmedia.android.MediaJobService
import expo.modules.designmedia.android.Probe
import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.EncoderStatsStore
import expo.modules.designmedia.core.QueueStore
import expo.modules.designmedia.core.decodeJobs
import expo.modules.designmedia.core.toStatusMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class DesignMediaModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("DesignMedia")

    Events(MediaJobService.EVENT_PROGRESS, MediaJobService.EVENT_QUEUE)

    OnCreate {
      MediaJobService.listener = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      MediaJobService.listener = null
    }

    AsyncFunction("probe") { uri: String -> Probe.read(context, Uri.parse(uri)) }

    AsyncFunction("codecReport") { CodecReport.list() }

    AsyncFunction("persistAccess") { uri: String -> Access.persist(context, Uri.parse(uri)) }

    AsyncFunction("freeBytes") { context.cacheDir.usableSpace }

    AsyncFunction("encoderStats") {
      EncoderStatsStore(AtomicFile(File(context.filesDir, "encoder-stats.json"))).all()
    }

    AsyncFunction("enqueue") { jobsJson: String, cbrOnly: Boolean ->
      val ids = decodeJobs(jobsJson).map { it.id }
      MediaJobService.enqueue(context, jobsJson, cbrOnly)
      ids
    }

    AsyncFunction("cancel") { id: String -> MediaJobService.cancel(context, id) }

    AsyncFunction("queue") {
      QueueStore(AtomicFile(File(context.filesDir, "media-queue.json"))).load().map { it.toStatusMap() }
    }

    // saveFile posts from the editor page: designs cross as text, exports as base64 (SPEC §14.3)
    AsyncFunction("saveJson") { name: String, text: String, filePath: String? ->
      DesignSaves.publish(context, name, "json", text, null, filePath)
    }

    AsyncFunction("saveExport") { name: String, ext: String, base64: String ->
      DesignSaves.publish(context, name, ext, null, base64, null)
    }
  }
}
