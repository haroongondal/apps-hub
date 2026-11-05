package expo.modules.strongroomvault.core

class MergeLocal(val id: String, val rev: Long, val dirty: Boolean, val sealed: ByteArray, val entry: Entry?)

class MergeRemote(val id: String, val rev: Long, val sealed: ByteArray, val entry: Entry?)

data class PlannedPush(val id: String, val baseRev: Long)

data class MergePlan(
  val adopt: List<MergeRemote>,
  val push: List<PlannedPush>,
  val quarantine: List<MergeRemote>,
  val blocked: List<String>,
  val rebase: List<Rebase>,
  val conflicts: Int,
)

/** strongroom-core's planMerge, rule for rule (an entry is null when the record does not decrypt). */
object SyncMerge {
  // Last writer wins on updatedAt; on a tie the tombstone wins, otherwise the remote, so every device picks the same side.
  private fun localWins(l: Entry, r: Entry) =
    if (l.updatedAt != r.updatedAt) l.updatedAt > r.updatedAt else l is Entry.Deleted && r !is Entry.Deleted

  fun plan(local: List<MergeLocal>, remote: List<MergeRemote>): MergePlan {
    val adopt = ArrayList<MergeRemote>()
    val push = ArrayList<PlannedPush>()
    val quarantine = ArrayList<MergeRemote>()
    val blocked = ArrayList<String>()
    val rebase = ArrayList<Rebase>()
    var conflicts = 0
    val mine = local.associateBy { it.id }
    val handled = HashSet<String>()
    for (r in remote) {
      val l = mine[r.id]
      when {
        l != null && l.entry == null -> {
          blocked += r.id
          if (r.entry == null) quarantine += r else if (r.rev > l.rev) rebase += Rebase(r.id, r.rev)
        }
        l != null && l.sealed.contentEquals(r.sealed) -> adopt += r
        r.entry == null -> {
          quarantine += r
          blocked += r.id
        }
        l != null && r.rev <= l.rev -> continue
        l == null || !l.dirty -> adopt += r
        else -> {
          conflicts++
          if (localWins(l.entry!!, r.entry)) {
            push += PlannedPush(r.id, r.rev)
            rebase += Rebase(r.id, r.rev)
          } else {
            adopt += r
          }
        }
      }
      handled += r.id
    }
    for (l in local) {
      if (l.id in handled) continue
      if (l.entry == null) blocked += l.id else if (l.dirty) push += PlannedPush(l.id, l.rev)
    }
    return MergePlan(adopt, push, quarantine, blocked, rebase, conflicts)
  }
}
