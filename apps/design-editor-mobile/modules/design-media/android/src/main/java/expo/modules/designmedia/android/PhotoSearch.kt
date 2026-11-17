package expo.modules.designmedia.android

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.ClipModels
import expo.modules.designmedia.core.ClipTokenizer
import expo.modules.designmedia.core.PhotoIndexFile
import expo.modules.designmedia.core.PhotoRow
import expo.modules.designmedia.core.QueueStore
import expo.modules.designmedia.core.SEARCH_FLOOR
import expo.modules.designmedia.core.SEARCH_LIMIT
import expo.modules.designmedia.core.SEARCH_MARGIN
import expo.modules.designmedia.core.SIMILAR_FLOOR
import expo.modules.designmedia.core.encodeJobs
import expo.modules.designmedia.core.needsScan
import expo.modules.designmedia.core.planIndexStart
import expo.modules.designmedia.core.rank
import expo.modules.designmedia.core.searchText
import expo.modules.designmedia.core.shownQueue
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.util.UUID

class SearchToolNotReady : CodedException("The search tool isn't ready yet.")

// Everything the search tab asks of the phone; DesignMediaModule only delegates here. No network is used on this path.
object PhotoSearch {
  private val IMAGES = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
  private val tokenizerLock = Any()
  private var tokenizer: ClipTokenizer? = null
  private var cached: Triple<Long, Long, List<PhotoRow>>? = null

  private fun modelsDir(ctx: Context) = File(ctx.filesDir, "models")

  private fun indexFile(ctx: Context) = File(ctx.filesDir, "photo-index.bin")

  private fun modelsReady(ctx: Context) = ClipModels.ALL.all { ClipModels.isReady(modelsDir(ctx), it) }

  fun models(ctx: Context): List<Map<String, Any>> = ClipModels.ALL.map {
    mapOf("name" to it.name, "url" to it.url, "bytes" to it.bytes, "ready" to ClipModels.isReady(modelsDir(ctx), it))
  }

  fun install(ctx: Context, name: String): Boolean {
    val model = ClipModels.ALL.firstOrNull { it.name == name } ?: return false
    return ClipModels.install(modelsDir(ctx), model)
  }

  fun startIndex(ctx: Context): String {
    val shown = shownQueue(QueueStore(AtomicFile(File(ctx.filesDir, "media-queue.json"))).load(), MediaJobService.alive)
    val start = planIndexStart(shown, UUID.randomUUID().toString())
    start.stale.forEach { MediaJobService.cancel(ctx, it) }
    // A waiting scan needs the service running to be picked up; an empty enqueue wakes it without adding a job.
    if (!MediaJobService.alive || start.job != null) MediaJobService.enqueue(ctx, encodeJobs(listOfNotNull(start.job)), false)
    return start.id
  }

  fun indexed(ctx: Context): Int = index(ctx).size

  fun state(ctx: Context): Map<String, Any?> =
    mapOf("indexed" to indexed(ctx), "modelsReady" to modelsReady(ctx), "waiting" to PhotoIndexRunner.waitingFor,
      "lastScan" to PhotoIndexRunner.stampFile(ctx).lastModified())

  fun galleryChanged(ctx: Context): Boolean = needsScan(AtomicFile(PhotoIndexRunner.stampFile(ctx)).read(), Gallery.stamp(ctx))

  fun search(ctx: Context, query: String): List<String> {
    if (!modelsReady(ctx)) throw SearchToolNotReady()
    if (query.isBlank()) return emptyList()
    val ids = synchronized(tokenizerLock) { tokenizer(ctx).encode(searchText(query)) }
    val vector = ClipSessions.embedQuery(ctx, ids)
    return rank(index(ctx), vector, SEARCH_LIMIT, SEARCH_FLOOR, SEARCH_MARGIN).map(::uriOf)
  }

  fun similar(ctx: Context, uri: String): List<String> {
    val id = idOf(uri) ?: return emptyList()
    val rows = index(ctx)
    val own = rows.firstOrNull { it.key.id == id } ?: return emptyList()
    val vector = FloatArray(own.vec.size) { own.vec[it] / 127f }
    return rank(rows.filter { it.key.id != id }, vector, SEARCH_LIMIT, SIMILAR_FLOOR).map(::uriOf)
  }

  fun release() = ClipSessions.releaseText()

  @Synchronized private fun index(ctx: Context): List<PhotoRow> {
    val file = indexFile(ctx)
    val stamp = file.lastModified()
    val size = file.length()
    cached?.takeIf { it.first == stamp && it.second == size }?.let { return it.third }
    return PhotoIndexFile.read(file).also { cached = Triple(stamp, size, it) }
  }

  private fun tokenizer(ctx: Context): ClipTokenizer =
    tokenizer ?: ClipTokenizer.fromJson(ctx.assets.open("clip/tokenizer.json").use { it.reader().readText() }).also { tokenizer = it }

  private fun uriOf(id: Long): String = ContentUris.withAppendedId(IMAGES, id).toString()

  private fun idOf(uri: String): Long? =
    if (uri.startsWith("$IMAGES/")) runCatching { ContentUris.parseId(Uri.parse(uri)) }.getOrNull() else null
}
