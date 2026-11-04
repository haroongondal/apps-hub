package expo.modules.designmedia.android

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.designmedia.core.Messages

// The receiving app gets a read grant for this one file; nothing is copied or sent anywhere by this module.
object Intents {
  fun share(context: Context, uri: Uri) {
    val send = Intent(Intent.ACTION_SEND)
      .setType(context.contentResolver.getType(uri) ?: "*/*")
      .putExtra(Intent.EXTRA_STREAM, uri)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    send.clipData = ClipData.newRawUri(null, uri)
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
  }

  fun view(context: Context, uri: Uri) {
    val view = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, context.contentResolver.getType(uri) ?: "*/*")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(view)
    } catch (e: ActivityNotFoundException) {
      throw IllegalStateException(Messages.NO_APP)
    }
  }
}
