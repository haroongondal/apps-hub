package expo.modules.audiochunks.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.system.Os
import android.widget.Toast
import androidx.core.content.IntentCompat
import expo.modules.audiochunks.core.ShareRules
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.SecureRandom

// No UI: copies what was shared into the inbox while it still holds the read grant, then opens Nexus's Intake screen
// with only the inbox id. Nothing is added until the user taps Add there.
class ShareActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val received = intent
    if (savedInstanceState != null || (received.action != Intent.ACTION_SEND && received.action != Intent.ACTION_SEND_MULTIPLE)) {
      finish()
      return
    }
    Thread {
      val id = runCatching { ShareInbox.receive(applicationContext, received) }.getOrNull()
      runOnUiThread {
        if (id != null) {
          startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("pdfeditor://share?inbox=$id")).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else {
          Toast.makeText(this, "Nexus couldn't take what you shared. Try again.", Toast.LENGTH_LONG).show()
        }
        finish()
      }
    }.start()
  }
}

object ShareInbox {
  fun receive(context: Context, intent: Intent): String {
    val streams = streamsOf(intent)
    val id = ShareRules.inboxId(System.currentTimeMillis(), SecureRandom())
    val dir = File(File(context.filesDir, ShareRules.INBOX_DIR), id)
    check(dir.mkdirs()) { "Could not make the inbox." }
    try {
      val files = JSONArray()
      if (streams.size <= ShareRules.MAX_ITEMS) {
        var budget = ShareRules.MAX_SHARE_BYTES
        val own = OwnStorage(context)
        streams.forEachIndexed { i, uri ->
          val entry = copyOne(context, own, uri, dir, i.toString(), minOf(ShareRules.MAX_ITEM_BYTES, budget))
          budget -= entry.optLong("size", 0)
          files.put(entry)
        }
      }
      val manifest = JSONObject()
        .put("v", 1)
        .put("createdAt", System.currentTimeMillis())
        .put("text", ShareRules.truncate(intent.getCharSequenceExtra(Intent.EXTRA_TEXT), ShareRules.MAX_TEXT + 1) ?: JSONObject.NULL)
        .put("subject", ShareRules.truncate(intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT), ShareRules.MAX_SUBJECT) ?: JSONObject.NULL)
        .put("count", streams.size)
        .put("files", files)
      val tmp = File(dir, "inbox.json.tmp")
      tmp.writeText(manifest.toString())
      check(tmp.renameTo(File(dir, "inbox.json"))) { "Could not save the inbox." }
      return id
    } catch (e: Exception) {
      dir.deleteRecursively()
      throw e
    }
  }

  private fun streamsOf(intent: Intent): List<Uri> =
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty().filterNotNull()
    } else {
      listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
    }

  private fun copyOne(context: Context, own: OwnStorage, uri: Uri, dir: File, name: String, cap: Long): JSONObject {
    val entry = JSONObject().put("file", JSONObject.NULL).put("name", "Shared file").put("mime", "").put("sniffed", "unknown").put("size", 0).put("refused", JSONObject.NULL)
    if (!own.allows(uri, null)) return entry.put("refused", "not-allowed")
    val out = File(dir, name)
    try {
      val resolver = context.contentResolver
      entry.put("mime", resolver.getType(uri) ?: "")
      entry.put("name", ShareRules.displayName(nameOf(context, uri)))
      // The same call openInputStream makes, kept open so the bytes copied come from the descriptor whose path was checked.
      val size = resolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
        if (!own.allows(uri, realPath(afd.parcelFileDescriptor))) return entry.put("refused", "not-allowed")
        afd.createInputStream().use { input -> FileOutputStream(out).use { ShareRules.copyCapped(input, it, cap) } }
      } ?: return entry.put("refused", "unreadable")
      if (size < 0) {
        out.delete()
        return entry.put("refused", "too-big")
      }
      val head = ByteArray(ShareRules.HEAD_BYTES)
      val read = FileInputStream(out).use { it.read(head) }
      return entry.put("file", name).put("size", size).put("sniffed", ShareRules.sniff(head.copyOf(maxOf(read, 0))))
    } catch (e: Exception) {
      out.delete()
      return entry.put("refused", "unreadable")
    }
  }

  private fun nameOf(context: Context, uri: Uri): String? =
    runCatching {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null
      }
    }.getOrNull() ?: uri.lastPathSegment

  private fun realPath(fd: ParcelFileDescriptor): String? = runCatching { Os.readlink("/proc/self/fd/${fd.fd}") }.getOrNull()

  private class OwnStorage(private val context: Context) {
    private val pm = context.packageManager
    private val pkg = context.packageName

    private val authorities: List<String> by lazy {
      val flags = PackageManager.GET_PROVIDERS or PackageManager.MATCH_DISABLED_COMPONENTS
      val info = if (Build.VERSION.SDK_INT >= 33) {
        pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(flags.toLong()))
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(pkg, flags)
      }
      info.providers.orEmpty().flatMap { it.authority.orEmpty().split(';') }
    }

    private val dirs: List<String> by lazy {
      listOf(context.dataDir, context.filesDir, context.cacheDir, context.noBackupFilesDir, context.codeCacheDir,
        context.createDeviceProtectedStorageContext().dataDir, File("/data/data", pkg))
        .flatMap { listOf(it.absolutePath, runCatching { it.canonicalPath }.getOrNull()) }
        .filterNotNull()
    }

    fun allows(uri: Uri, realPath: String?): Boolean {
      val authority = uri.authority
      @Suppress("DEPRECATION")
      val resolved = authority?.let { runCatching { pm.resolveContentProvider(it, 0)?.packageName }.getOrNull() }
      return ShareRules.sourceAllowed(uri.scheme, authority, uri.host, authorities, pkg, resolved, realPath, dirs)
    }
  }
}
