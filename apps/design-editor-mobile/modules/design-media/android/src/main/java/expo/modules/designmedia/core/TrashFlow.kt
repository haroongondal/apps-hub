package expo.modules.designmedia.core

// Codes stay in the low 16 bits that FragmentActivity allows.
enum class TrashAction(val requestCode: Int) { TRASH(0x5C10), RESTORE(0x5C11) }

class TrashPending<P>(val action: TrashAction, val uris: List<String>, val promise: P)

// One open Android dialog at a time; P is the module's Promise, generic so this stays JVM-testable.
class TrashFlow<P> {
  private var pending: TrashPending<P>? = null

  @Synchronized fun begin(action: TrashAction, uris: List<String>, promise: P): Boolean {
    if (pending != null) return false
    pending = TrashPending(action, uris, promise)
    return true
  }

  @Synchronized fun finish(requestCode: Int, ok: Boolean): Pair<TrashPending<P>, Boolean>? {
    val p = pending?.takeIf { it.action.requestCode == requestCode } ?: return null
    pending = null
    return p to ok
  }

  @Synchronized fun abort(): TrashPending<P>? = pending.also { pending = null }
}

fun galleryImageId(uri: String, base: String): Long? {
  val rest = uri.removePrefix("$base/").takeIf { it.length < uri.length } ?: return null
  return if (rest.isNotEmpty() && rest.all { it in '0'..'9' }) rest.toLongOrNull() else null
}
