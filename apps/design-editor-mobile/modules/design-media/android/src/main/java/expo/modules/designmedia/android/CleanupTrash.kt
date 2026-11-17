package expo.modules.designmedia.android

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import expo.modules.designmedia.core.TrashAction
import expo.modules.designmedia.core.TrashEntry
import expo.modules.designmedia.core.TrashFlow
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException

class NoActivity(action: TrashAction) :
  CodedException(if (action == TrashAction.TRASH) "Open the app to remove photos." else "Open the app to restore photos.")

class RequestStillOpen : CodedException("Another request is still open.")

class DialogFailed(cause: Throwable) : CodedException("Android's dialog didn't open. Try again.", cause)

class TrashNotNoted(cause: Throwable) :
  CodedException("The photos went to Android's trash, but Clean up couldn't note them. Find them in your Gallery app's trash.", cause)

// The only way a gallery photo leaves: Android's own trash dialog, confirmed by the owner (AC-1). Never a delete.
class CleanupTrash {
  private class Held(val promise: Promise, val entries: List<TrashEntry>)

  private val flow = TrashFlow<Held>()

  fun start(ctx: Context, activity: Activity?, action: TrashAction, uris: List<String>, promise: Promise) {
    val wanted = uris.distinct()
    val ids = wanted.map { CleanupTool.idOf(it) ?: return promise.reject(NotAGalleryPhoto()) }
    if (ids.isEmpty()) return promise.resolve(answer(action, 0))
    val entries = if (action == TrashAction.TRASH) {
      lookUp(ctx, ids) ?: return promise.reject(GalleryUnreadable())
    } else wanted.map { TrashEntry(it, "", 0, 0) }
    if (entries.isEmpty()) return promise.resolve(answer(action, 0))
    if (activity == null) return promise.reject(NoActivity(action))
    if (!flow.begin(action, entries.map { it.uri }, Held(promise, entries))) return promise.reject(RequestStillOpen())
    activity.runOnUiThread {
      try {
        val request = MediaStore.createTrashRequest(ctx.contentResolver, entries.map { Uri.parse(it.uri) }, action == TrashAction.TRASH)
        activity.startIntentSenderForResult(request.intentSender, action.requestCode, null, 0, 0, 0)
      } catch (e: Exception) {
        flow.abort()?.promise?.promise?.reject(DialogFailed(e))
      }
    }
  }

  fun onResult(ctx: Context, requestCode: Int, resultCode: Int) {
    val (pending, ok) = flow.finish(requestCode, resultCode == Activity.RESULT_OK) ?: return
    val held = pending.promise
    if (!ok) return held.promise.resolve(answer(pending.action, 0))
    try {
      val record = CleanupTool.record(ctx)
      if (pending.action == TrashAction.TRASH) {
        val now = System.currentTimeMillis()
        record.add(held.entries.map { it.copy(trashedAt = now) })
      } else {
        record.remove(pending.uris.toSet())
      }
    } catch (e: Exception) {
      return held.promise.reject(if (pending.action == TrashAction.TRASH) TrashNotNoted(e) else DialogFailed(e))
    }
    held.promise.resolve(answer(pending.action, pending.uris.size))
  }

  private fun answer(action: TrashAction, n: Int) = mapOf((if (action == TrashAction.TRASH) "moved" else "restored") to n)

  // Rows MediaStore no longer lists (already trashed or gone) are left out of the request.
  private fun lookUp(ctx: Context, ids: List<Long>): List<TrashEntry>? {
    val cols = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.SIZE)
    val cursor = runCatching {
      ctx.contentResolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols,
        "${MediaStore.Images.Media._ID} IN (${ids.joinToString(",")})", null, null)
    }.getOrNull() ?: return null
    return cursor.use { c ->
      buildList { while (c.moveToNext()) add(TrashEntry(CleanupTool.uriOf(c.getLong(0)), c.getString(1) ?: "", c.getLong(2), 0)) }
    }
  }
}
