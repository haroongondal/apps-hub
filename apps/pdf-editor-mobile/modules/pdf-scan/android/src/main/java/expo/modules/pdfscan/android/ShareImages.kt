package expo.modules.pdfscan.android

import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import java.io.File

// Its own subclass so the merged manifest never clashes with another library's FileProvider.
class PdfScanFileProvider : FileProvider()

object ShareImages {
  fun share(appContext: AppContext, paths: List<String>, chooserTitle: String) {
    require(paths.isNotEmpty()) { "no images to share" }
    val context = appContext.reactContext ?: throw IllegalStateException("the app isn't running")
    val roots = listOf(context.cacheDir, context.filesDir).map { it.canonicalPath + File.separator }
    val authority = "${context.packageName}.pdfscan.fileprovider"
    // The provider serves only this folder (pdfscan_paths.xml), so it can never hand out the library or the database.
    val out = File(context.cacheDir, "pdfscan-share").apply { deleteRecursively(); mkdirs() }
    val uris = paths.map { p ->
      val file = existingFile(p).canonicalFile
      if (roots.none { file.path.startsWith(it) }) throw CodedException("not_found", "${file.name} isn't in this app's storage.", null)
      FileProvider.getUriForFile(context, authority, file.copyTo(File(out, file.name), overwrite = true))
    }
    val send = if (uris.size == 1) {
      Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
    } else {
      Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
    }
    send.type = "image/jpeg"
    send.clipData = ClipData.newRawUri(null, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val chooser = Intent.createChooser(send, chooserTitle)
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(chooser)
    } else {
      context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }
}
