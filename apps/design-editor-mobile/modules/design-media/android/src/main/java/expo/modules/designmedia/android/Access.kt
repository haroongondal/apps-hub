package expo.modules.designmedia.android

import android.content.Context
import android.content.Intent
import android.net.Uri

object Access {
  fun persist(context: Context, uri: Uri): Boolean = try {
    context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    true
  } catch (e: SecurityException) {
    false
  }
}
