package expo.modules.designmedia.android

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import expo.modules.designmedia.core.TrashAction
import expo.modules.designmedia.core.TrashEntry
import expo.modules.designmedia.core.TrashFlow
import expo.modules.designmedia.core.trashAnswer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException

class NoActivity(action: TrashAction) :
  CodedException(if (action == TrashAction.TRASH) "Open the app to remove photos." else "Open the app to restore photos.")

class RequestStillOpen : CodedException("Another request is still open.")

class DialogFailed(cause: Throwable) : CodedException("Android's dialog didn't open. Try again.", cause)

class TrashNotNoted(cause: Throwable) :
  CodedException("The photos went to Android's trash, but Clean up couldn't note them. Find them in your Gallery app's trash.", cause)

// The only way a gallery photo leaves: Android's own trash dialog, confirmed by the owner (AC-1). Never a delete.
// Process-wide, so a confirmed result still gets recorded after a JS reload made a new module instance.
object CleanupTrash {
  private class Held(val promise: Promise, val entries: List<TrashEntry>)

  private val flow = TrashFlow<Held>()

  // The promise may belong to a JS runtime that has since reloaded.
  private fun settle(promise: Promise, block: Promise.() -> Unit) { runCatching { promise.block() } }

  fun start(ctx: Context, activity: Activity?, action: TrashAction, uris: List<String>, promise: Promise) {
    val wanted = uris.distinct()
    val ids = wanted.map { CleanupTool.idOf(it) ?: return promise.reject(NotAGalleryPhoto()) }
    if (ids.isEmpty()) return promise.resolve(trashAnswer(action, emptyList()))
    val entries = if (action == TrashAction.TRASH) {
      lookUp(ctx, ids) ?: return promise.reject(GalleryUnreadable())
    } else wanted.map { TrashEntry(it, "", 0, 0) }
    if (entries.isEmpty()) return promise.resolve(trashAnswer(action, emptyList()))
    if (activity == null) return promise.reject(NoActivity(action))
    if (!flow.begin(action, entries.map { it.uri }, Held(promise, entries))) return promise.reject(RequestStillOpen())
    activity.runOnUiThread {
      try {
        val request = MediaStore.createTrashRequest(ctx.contentResolver, entries.map { Uri.parse(it.uri) }, action == TrashAction.TRASH)
        activity.startIntentSenderForResult(request.intentSender, action.requestCode, null, 0, 0, 0)
        flow.launched()
      } catch (e: Exception) {
        flow.abort()?.let { settle(it.promise.promise) { reject(DialogFailed(e)) } }
      }
    }
  }

  fun onResult(ctx: Context, requestCode: Int, resultCode: Int) {
    val (pending, ok) = flow.finish(requestCode, resultCode == Activity.RESULT_OK) ?: return
    val held = pending.promise
    if (!ok) return settle(held.promise) { resolve(trashAnswer(pending.action, emptyList())) }
    if (pending.action == TrashAction.TRASH) {
      val now = System.currentTimeMillis()
      try {
        CleanupTool.record(ctx).add(held.entries.map { it.copy(trashedAt = now) })
      } catch (e: Exception) {
        return settle(held.promise) { reject(TrashNotNoted(e)) }
      }
    } else {
      // Restored either way; a stale entry drops on the next recentlyRemoved.
      runCatching { CleanupTool.record(ctx).remove(pending.uris.toSet()) }
    }
    settle(held.promise) { resolve(trashAnswer(pending.action, pending.uris)) }
  }

  // Back in the app with a launched dialog unanswered (blocked launch, finished Activity): free the flow. A real answer
  // is always handled first: Android delivers the result before onResume, and RN and Expo forward both synchronously on
  // the main thread.
  fun onForeground() {
    val pending = flow.resumed() ?: return
    settle(pending.promise.promise) { resolve(trashAnswer(pending.action, emptyList())) }
  }

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
