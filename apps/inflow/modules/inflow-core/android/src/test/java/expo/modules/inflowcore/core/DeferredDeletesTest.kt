package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Test

class DeferredDeletesTest {
  @Test fun aCommittedOutermostTransactionReleasesTheFiles() {
    val d = DeferredDeletes().apply { add("a"); add("b") }
    assertEquals(listOf("a", "b"), d.ended(committed = true, outermost = true))
    assertEquals(emptyList<String>(), d.ended(committed = true, outermost = true))
  }

  @Test fun anInnerTransactionReleasesNothing() {
    val d = DeferredDeletes().apply { add("a") }
    assertEquals(emptyList<String>(), d.ended(committed = true, outermost = false))
    assertEquals(listOf("a"), d.ended(committed = true, outermost = true))
  }

  @Test fun aFailedTransactionLeavesLiveFilesAloneAndForgetsThem() {
    val d = DeferredDeletes().apply { add("a") }
    assertEquals(emptyList<String>(), d.ended(committed = false, outermost = true))
    // A later successful transaction must not delete what the failed one queued.
    d.add("b")
    assertEquals(listOf("b"), d.ended(committed = true, outermost = true))
  }

  @Test fun anInnerFailureCaughtByTheCallerStillRollsEverythingBack() {
    val d = DeferredDeletes().apply { add("a") }
    d.ended(committed = false, outermost = false)
    assertEquals(emptyList<String>(), d.ended(committed = true, outermost = true))
    d.add("c")
    assertEquals(listOf("c"), d.ended(committed = true, outermost = true))
  }
}
