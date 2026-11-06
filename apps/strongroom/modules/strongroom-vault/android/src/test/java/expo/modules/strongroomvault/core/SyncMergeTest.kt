package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncMergeTest {
  private val t = 1_800_000_000_000L
  private val day = 86_400_000L
  private fun bytes(n: Int) = ByteArray(32) { n.toByte() }
  private fun login(name: String, updatedAt: Long) = Entry.Login(name, "me", "pw", emptyList(), emptyList(), "", updatedAt)
  private fun tombstone(updatedAt: Long) = Entry.Deleted(updatedAt)
  private fun local(id: String, rev: Long = 3, dirty: Boolean = true, sealed: ByteArray = bytes(1), entry: Entry? = login("mine", t)) =
    MergeLocal(id, rev, dirty, sealed, entry)
  private fun remote(id: String, rev: Long = 9, sealed: ByteArray = bytes(2), entry: Entry? = login("theirs", t)) =
    MergeRemote(id, rev, sealed, entry)
  private val empty = MergePlan(emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), 0)
  private val a9 = empty.copy(push = listOf(PlannedPush("a", 9)), rebase = listOf(Rebase("a", 9)), conflicts = 1)
  private fun plan(local: List<MergeLocal>, remote: List<MergeRemote>) = SyncMerge.plan(local, remote)

  @Test fun remoteOnlyIsAdopted() {
    val r = remote("a")
    assertEquals(empty.copy(adopt = listOf(r)), plan(emptyList(), listOf(r)))
  }

  @Test fun localOnlyIsPushedWithBaseRevZero() {
    assertEquals(empty.copy(push = listOf(PlannedPush("new", 0))), plan(listOf(local("new", rev = 0)), emptyList()))
    assertEquals(
      empty.copy(push = listOf(PlannedPush("edited", 7))),
      plan(listOf(local("edited", rev = 7), local("clean", dirty = false)), emptyList()),
    )
  }

  @Test fun cleanLocalTakesRemote() {
    val r = remote("a", entry = login("theirs", t))
    assertEquals(empty.copy(adopt = listOf(r)), plan(listOf(local("a", dirty = false, entry = login("mine", t + day))), listOf(r)))
  }

  @Test fun laterEditWins() {
    val older = remote("a", entry = login("theirs", t))
    assertEquals(a9, plan(listOf(local("a", entry = login("mine", t + 5))), listOf(older)))
    val newer = remote("a", entry = login("theirs", t + 5))
    assertEquals(empty.copy(adopt = listOf(newer), conflicts = 1), plan(listOf(local("a", entry = login("mine", t))), listOf(newer)))
  }

  @Test fun tombstoneWinsOnEqualTime() {
    val gone = remote("a", entry = tombstone(t))
    assertEquals(empty.copy(adopt = listOf(gone), conflicts = 1), plan(listOf(local("a", entry = login("mine", t))), listOf(gone)))
    assertEquals(a9, plan(listOf(local("a", entry = tombstone(t))), listOf(remote("a", entry = login("theirs", t)))))
    val same = remote("a", entry = login("theirs", t))
    assertEquals(empty.copy(adopt = listOf(same), conflicts = 1), plan(listOf(local("a", entry = login("mine", t))), listOf(same)))
  }

  @Test fun editNewerThanTombstoneWins() {
    assertEquals(a9, plan(listOf(local("a", entry = login("mine", t + 1))), listOf(remote("a", entry = tombstone(t)))))
    val edit = remote("a", entry = login("theirs", t + 1))
    assertEquals(empty.copy(adopt = listOf(edit), conflicts = 1), plan(listOf(local("a", entry = tombstone(t))), listOf(edit)))
  }

  @Test fun undecryptableRemoteIsQuarantinedAndBlocked() {
    val bad = remote("a", entry = null)
    assertEquals(empty.copy(quarantine = listOf(bad), blocked = listOf("a")), plan(emptyList(), listOf(bad)))
  }

  @Test fun readableLocalBeatsUndecryptableRemote() {
    val bad = remote("a", entry = null)
    assertEquals(empty.copy(quarantine = listOf(bad), blocked = listOf("a")), plan(listOf(local("a")), listOf(bad)))
    assertEquals(empty.copy(quarantine = listOf(bad), blocked = listOf("a")), plan(listOf(local("a", dirty = false)), listOf(bad)))
  }

  @Test fun unreadableLocalIsKeptAndReported() {
    for (dirty in listOf(true, false)) {
      assertEquals(
        empty.copy(blocked = listOf("b"), rebase = listOf(Rebase("b", 9))),
        plan(listOf(local("b", entry = null, dirty = dirty)), listOf(remote("b"))),
      )
      assertEquals(empty.copy(blocked = listOf("b")), plan(listOf(local("b", entry = null, dirty = dirty, rev = 9)), listOf(remote("b"))))
      assertEquals(empty.copy(blocked = listOf("c")), plan(listOf(local("c", entry = null, dirty = dirty)), emptyList()))
      // Not rebased onto a remote it can't read either, so the quarantine still stops a later rewrite from uploading over it.
      val bad = remote("d", entry = null)
      assertEquals(
        empty.copy(quarantine = listOf(bad), blocked = listOf("d")),
        plan(listOf(local("d", entry = null, dirty = dirty)), listOf(bad)),
      )
    }
  }

  @Test fun neverDeletesAnything() {
    val locals = listOf(local("a", dirty = false), local("b"), local("c", entry = tombstone(t + 1)), local("d", entry = null))
    val remotes = listOf(remote("b", entry = tombstone(t + day)), remote("e", entry = null), remote("f", entry = tombstone(t)))
    val p = plan(locals, remotes)
    assertEquals(
      listOf("adopt", "blocked", "conflicts", "push", "quarantine", "rebase"),
      MergePlan::class.java.declaredFields.map { it.name }.sorted(),
    )
    for (r in p.adopt) assertTrue(remotes.any { it === r })
    val touched = (p.adopt.map { it.id } + p.push.map { it.id } + p.blocked).toSortedSet()
    assertEquals(sortedSetOf("b", "c", "d", "e", "f"), touched)
  }

  @Test fun interruptedPushIsNotAConflict() {
    val back = remote("a", sealed = bytes(1), rev = 12)
    assertEquals(empty.copy(adopt = listOf(back)), plan(listOf(local("a", sealed = bytes(1), rev = 3)), listOf(back)))
    // Our own push coming back at the rev this newer edit is already based on: the remote did not change, so the edit just goes up.
    assertEquals(empty.copy(push = listOf(PlannedPush("a", 12))), plan(listOf(local("a", sealed = bytes(3), rev = 12)), listOf(back)))
  }

  @Test fun skewedClockIsDeterministicAndCounted() {
    val ahead = remote("a", entry = login("theirs", t + day))
    val mine = local("a", entry = login("mine", t))
    val first = plan(listOf(mine), listOf(ahead))
    assertEquals(empty.copy(adopt = listOf(ahead), conflicts = 1), first)
    assertEquals(first, plan(listOf(mine), listOf(ahead)))
  }
}
