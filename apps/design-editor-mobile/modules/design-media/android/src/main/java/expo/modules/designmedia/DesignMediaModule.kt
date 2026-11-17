package expo.modules.designmedia

import android.net.Uri
import expo.modules.designmedia.android.Access
import expo.modules.designmedia.android.CleanupTool
import expo.modules.designmedia.android.CleanupTrash
import expo.modules.designmedia.android.CodecReport
import expo.modules.designmedia.android.CompositionView
import expo.modules.designmedia.android.DesignSaves
import expo.modules.designmedia.android.Intents
import expo.modules.designmedia.android.MediaJobService
import expo.modules.designmedia.android.PhotoSearch
import expo.modules.designmedia.android.Probe
import expo.modules.designmedia.android.Thumbs
import expo.modules.designmedia.android.Waveform
import expo.modules.designmedia.vision.Vision
import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.EncoderStatsStore
import expo.modules.designmedia.core.QueueStore
import expo.modules.designmedia.core.TrashAction
import expo.modules.designmedia.core.decodeJobs
import expo.modules.designmedia.core.shownQueue
import expo.modules.designmedia.core.thumbFolder
import expo.modules.designmedia.core.toStatusMap
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class DesignMediaModule : Module() {
  private val readScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

  private val trash = CleanupTrash()

  private val context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("DesignMedia")

    Events(MediaJobService.EVENT_PROGRESS, MediaJobService.EVENT_QUEUE, Vision.EVENT_PROGRESS)

    View(CompositionView::class) {
      Events("onPosition", "onEnded", "onError")
      Prop("plan") { view: CompositionView, plan: String? -> view.setPlan(plan) }
      Prop("playing") { view: CompositionView, playing: Boolean -> view.setPlaying(playing) }
      AsyncFunction("seekTo") { view: CompositionView, timeS: Double -> view.seekTo(timeS) }.runOnQueue(Queues.MAIN)
      AsyncFunction("setScrubbing") { view: CompositionView, on: Boolean -> view.setScrubbing(on) }.runOnQueue(Queues.MAIN)
      OnViewDestroys { view: CompositionView -> view.release() }
    }

    OnCreate {
      MediaJobService.listener = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      MediaJobService.listener = null
    }

    OnActivityEntersBackground { CompositionView.pauseAll() }

    OnActivityResult { _, result -> trash.onResult(context, result.requestCode, result.resultCode) }

    AsyncFunction("probe") { uri: String -> Probe.read(context, Uri.parse(uri)) }

    AsyncFunction("keyframeAtOrBefore") { uri: String, timeS: Double -> Probe.keyframeAtOrBefore(context, Uri.parse(uri), timeS) }

    // The default queue is one thread shared by every Expo module, so a sixty-tile filmstrip or a long sound decode
    // would hold up the file picker and Start; these three read media on their own threads.
    AsyncFunction("thumbnails") { uri: String, timesS: List<Double>, width: Int, folder: String? ->
      Thumbs.write(context, Uri.parse(uri), timesS, width, thumbFolder(folder))
    }.runOnQueue(readScope)

    AsyncFunction("clearThumbs") { folder: String ->
      File(context.cacheDir, thumbFolder(folder)).deleteRecursively()
      Unit
    }.runOnQueue(readScope)

    AsyncFunction("waveform") { uri: String, buckets: Int ->
      Waveform.peaks(context, Uri.parse(uri), buckets.coerceIn(8, 2000))
    }.runOnQueue(readScope)

    AsyncFunction("previewFrame") { uri: String, timeS: Double, width: Int ->
      Thumbs.write(context, Uri.parse(uri), listOf(timeS), width, "preview").first()
    }.runOnQueue(readScope)

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

    AsyncFunction("resume") { MediaJobService.resume(context) }

    AsyncFunction("clearQueue") { MediaJobService.clearQueue(context) }

    AsyncFunction("share") { uri: String -> Intents.share(context, Uri.parse(uri)) }

    AsyncFunction("open") { uri: String -> Intents.view(context, Uri.parse(uri)) }

    AsyncFunction("queue") {
      shownQueue(QueueStore(AtomicFile(File(context.filesDir, "media-queue.json"))).load(), MediaJobService.alive).map { it.toStatusMap() }
    }

    AsyncFunction("photoModels") { PhotoSearch.models(context) }

    AsyncFunction("installPhotoModel") { name: String -> PhotoSearch.install(context, name) }.runOnQueue(readScope)

    AsyncFunction("startPhotoIndex") { PhotoSearch.startIndex(context) }.runOnQueue(readScope)

    AsyncFunction("photoIndexState") { PhotoSearch.state(context) }.runOnQueue(readScope)

    AsyncFunction("photoGalleryChanged") { PhotoSearch.galleryChanged(context) }.runOnQueue(readScope)

    AsyncFunction("searchPhotos") { query: String -> PhotoSearch.search(context, query) }.runOnQueue(readScope)

    AsyncFunction("similarPhotos") { uri: String -> PhotoSearch.similar(context, uri) }.runOnQueue(readScope)

    AsyncFunction("releasePhotoSearch") { PhotoSearch.release() }

    AsyncFunction("cleanupGroups") { options: Map<String, Any?>? -> CleanupTool.groups(context, options) }.runOnQueue(readScope)

    AsyncFunction("trashPhotos") { uris: List<String>, promise: Promise ->
      trash.start(context, appContext.currentActivity, TrashAction.TRASH, uris, promise)
    }.runOnQueue(readScope)

    AsyncFunction("recentlyRemoved") { CleanupTool.recentlyRemoved(context) }.runOnQueue(readScope)

    AsyncFunction("restorePhotos") { uris: List<String>, promise: Promise ->
      trash.start(context, appContext.currentActivity, TrashAction.RESTORE, uris, promise)
    }.runOnQueue(readScope)

    AsyncFunction("dismissCleanup") { kind: String, uris: List<String> -> CleanupTool.dismiss(context, kind, uris) }.runOnQueue(readScope)

    AsyncFunction("clearCleanupDismissals") { CleanupTool.clearDismissals(context) }.runOnQueue(readScope)

    AsyncFunction("visionTools") { Vision.tools(context) }

    AsyncFunction("installVisionModel") { name: String -> Vision.install(context, name) }.runOnQueue(readScope)

    // ids must be unique per run: a cancel sent after a run ends stays set for its id, and the output is <id>.png.
    AsyncFunction("runVision") { id: String, op: String, src: String, option: String ->
      Vision.run(context, id, op, src, option) { sendEvent(Vision.EVENT_PROGRESS, mapOf("id" to id, "fraction" to it)) }
    }.runOnQueue(Vision.queue)

    AsyncFunction("cancelVision") { id: String -> Vision.cancel(id) }

    // saveFile posts from the editor page: designs cross as text, exports as base64 (SPEC §14.3)
    AsyncFunction("saveJson") { name: String, text: String, filePath: String? ->
      DesignSaves.publish(context, name, "json", text, null, filePath)
    }

    AsyncFunction("saveExport") { name: String, ext: String, base64: String ->
      DesignSaves.publish(context, name, ext, null, base64, null)
    }
  }
}
