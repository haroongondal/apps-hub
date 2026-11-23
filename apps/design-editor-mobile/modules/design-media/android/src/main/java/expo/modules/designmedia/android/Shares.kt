package expo.modules.designmedia.android

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import android.system.Os
import expo.modules.designmedia.core.SHARE_MAX_BYTES
import expo.modules.designmedia.core.acceptShareUris
import expo.modules.designmedia.core.copyCapped
import expo.modules.designmedia.core.expiredBatches
import expo.modules.designmedia.core.fitsOnDisk
import expo.modules.designmedia.core.headOf
import expo.modules.designmedia.core.insidePrivateDirs
import expo.modules.designmedia.core.isOwnAuthority
import expo.modules.designmedia.core.problemOf
import java.io.File
import java.io.FileInputStream
import java.io.IOException

// Pictures and videos other apps share with Design Editor. Each stream is copied into the app's own folder the moment
// the intent is read, so no content address is kept; nothing is processed, sent or listed in the queue from here.
object Shares {
  const val EVENT = "onShare"
  private const val TAKEN = "designeditor.share.taken"

  private val items = mutableListOf<Map<String, Any?>>()
  private var overCap = 0
  private var blocked = 0

  // The one intake an action activity can call with its own intent; take() hands the copies to the app.
  @Synchronized
  fun capture(context: Context, intent: Intent?) {
    if (intent == null || intent.getBooleanExtra(TAKEN, false)) return
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
    val uris = streams(intent)
    if (uris.isEmpty()) return
    intent.putExtra(TAKEN, true)
    val own = ownAuthorities(context)
    val accepted = acceptShareUris(uris.map { it.toString() }) { isOwnAuthority(it, own, { a -> ownerOf(context, a) }, context.packageName) }
    overCap += accepted.overCap
    blocked += accepted.blocked
    val root = File(context.filesDir, "shared")
    expiredBatches(root.list()?.toList().orEmpty(), System.currentTimeMillis()).forEach { File(root, it).deleteRecursively() }
    val batch = File(root, System.currentTimeMillis().toString()).apply { mkdirs() }
    accepted.keep.forEachIndexed { n, uri -> items += copyOne(context, Uri.parse(uri), File(batch, "$n.part"), intent.type) }
  }

  @Synchronized
  fun hasPending() = items.isNotEmpty() || overCap > 0 || blocked > 0

  @Synchronized
  fun take(context: Context, activityIntent: Intent?): Map<String, Any?> {
    capture(context, activityIntent)
    val result = mapOf("items" to items.toList(), "overCap" to overCap, "blocked" to blocked)
    items.clear()
    overCap = 0
    blocked = 0
    return result
  }

  private fun streams(intent: Intent): List<Uri> {
    val listed = when (intent.action) {
      Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
      Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
      else -> return emptyList()
    }
    val clip = intent.clipData
    return listed.ifEmpty { (0 until (clip?.itemCount ?: 0)).mapNotNull { clip?.getItemAt(it)?.uri } }
  }

  private fun copyOne(context: Context, uri: Uri, target: File, intentType: String?): Map<String, Any?> {
    val resolver = context.contentResolver
    var name = ""
    var size = -1L
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (!c.moveToFirst()) return@use
        name = c.getString(0).orEmpty()
        size = if (c.isNull(1)) -1L else c.getLong(1)
      }
    } catch (e: Exception) {
      return failed(uri, name, "unreadable")
    }
    val mime = resolver.getType(uri) ?: intentType.orEmpty()
    if (size > SHARE_MAX_BYTES) return failed(uri, name, "too_big", mime)
    if (!fitsOnDisk(size, target.parentFile?.usableSpace ?: 0L)) return failed(uri, name, "no_space", mime)
    return try {
      val bytes = (resolver.openFileDescriptor(uri, "r") ?: throw IOException("No stream")).use { fd ->
        if (insidePrivateDirs(realPath(fd) ?: "", privateDirs(context))) throw IOException("Private file")
        FileInputStream(fd.fileDescriptor).use { source -> target.outputStream().use { copyCapped(source, it) } }
      }
      mapOf("uri" to Uri.fromFile(target).toString(), "name" to name, "mime" to mime, "bytes" to bytes, "head" to headOf(target), "problem" to null)
    } catch (e: Exception) {
      target.delete()
      failed(uri, name, problemOf(e), mime)
    }
  }

  private fun failed(uri: Uri, name: String, problem: String, mime: String = ""): Map<String, Any?> =
    mapOf("uri" to "", "name" to name.ifEmpty { uri.lastPathSegment.orEmpty() }, "mime" to mime, "bytes" to 0L, "head" to emptyList<Int>(), "problem" to problem)

  private fun ownAuthorities(context: Context): Set<String> = context.packageManager
    .getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PROVIDERS.toLong()))
    .providers.orEmpty().flatMap { it.authority.orEmpty().split(';') }.filter { it.isNotEmpty() }.toSet()

  private fun ownerOf(context: Context, authority: String): String? =
    context.packageManager.resolveContentProvider(authority, PackageManager.ComponentInfoFlags.of(0))?.packageName

  // Where the descriptor really points; a pipe or socket has no path, so it is not a file of ours. Null when /proc cannot be read.
  private fun realPath(fd: android.os.ParcelFileDescriptor): String? = try {
    Os.readlink("/proc/self/fd/${fd.fd}").takeIf { it.startsWith("/") }?.let { File(it).canonicalPath }
  } catch (e: Exception) {
    null
  }

  private fun privateDirs(context: Context): List<String> {
    val roots = listOfNotNull(context.dataDir, context.createDeviceProtectedStorageContext().dataDir) +
      context.externalCacheDirs.filterNotNull().mapNotNull { it.parentFile } + context.obbDirs.filterNotNull()
    return roots.flatMap { listOf(it.absolutePath, runCatching { it.canonicalPath }.getOrDefault(it.absolutePath)) }.distinct()
  }
}
