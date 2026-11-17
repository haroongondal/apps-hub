package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class TrashFlowTest {
  private val a = listOf("content://media/external/images/media/1", "content://media/external/images/media/2")

  @Test
  fun requestCodesDiffer() = assertNotEquals(TrashAction.TRASH.requestCode, TrashAction.RESTORE.requestCode)

  @Test
  fun secondBeginWhileBusyIsRefused() {
    val flow = TrashFlow<String>()
    assertTrue(flow.begin(TrashAction.TRASH, a, "p1"))
    assertFalse(flow.begin(TrashAction.TRASH, a, "p2"))
    assertFalse(flow.begin(TrashAction.RESTORE, a, "p3"))
    assertEquals("p1", flow.finish(TrashAction.TRASH.requestCode, ok = true)?.first?.promise)
    assertTrue(flow.begin(TrashAction.RESTORE, a, "p4"))
  }

  @Test
  fun wrongRequestCodeIsIgnored() {
    val flow = TrashFlow<String>()
    assertNull(flow.finish(TrashAction.TRASH.requestCode, ok = true)) // nothing open
    flow.begin(TrashAction.TRASH, a, "p")
    assertNull(flow.finish(1234, ok = true))
    assertNull(flow.finish(TrashAction.RESTORE.requestCode, ok = true))
    assertFalse(flow.begin(TrashAction.TRASH, a, "p2")) // still open
    assertEquals("p", flow.finish(TrashAction.TRASH.requestCode, ok = true)?.first?.promise)
  }

  @Test
  fun cancelledRecordsNothing() {
    val flow = TrashFlow<String>()
    flow.begin(TrashAction.TRASH, a, "p")
    val (pending, ok) = flow.finish(TrashAction.TRASH.requestCode, ok = false)!!
    assertFalse(ok)
    assertEquals("p", pending.promise)
    assertNull(flow.finish(TrashAction.TRASH.requestCode, ok = true)) // answered once only
    assertTrue(flow.begin(TrashAction.TRASH, a, "p2"))
  }

  @Test
  fun okReturnsThePendingUris() {
    val flow = TrashFlow<String>()
    flow.begin(TrashAction.RESTORE, a, "p")
    val (pending, ok) = flow.finish(TrashAction.RESTORE.requestCode, ok = true)!!
    assertTrue(ok)
    assertSame(TrashAction.RESTORE, pending.action)
    assertEquals(a, pending.uris)
  }

  @Test
  fun abortFreesTheFlowForALaunchThatFailed() {
    val flow = TrashFlow<String>()
    assertNull(flow.abort())
    flow.begin(TrashAction.TRASH, a, "p")
    assertEquals("p", flow.abort()?.promise)
    assertNull(flow.finish(TrashAction.TRASH.requestCode, ok = true))
    assertTrue(flow.begin(TrashAction.TRASH, a, "p2"))
  }

  @Test
  fun refusesNonImageUris() {
    val base = "content://media/external/images/media"
    assertEquals(42L, galleryImageId("$base/42", base))
    listOf(
      "content://media/external/video/media/42", "content://media/external/images/media", "$base/", "$base/-1", "$base/+1",
      "$base/4x", "$base/42?x=1", "$base/42/thumb", "$base/99999999999999999999", "file:///sdcard/a.jpg",
      "content://com.other/images/media/42", "${base}42", "", "content://media/external/file/42",
    ).forEach { assertNull(it, galleryImageId(it, base)) }
  }

  @Test
  fun resumeAfterLaunchFreesTheFlowAndGivesThePendingBack() {
    val flow = TrashFlow<String>()
    flow.begin(TrashAction.TRASH, a, "p")
    flow.launched()
    assertEquals("p", flow.resumed()?.promise)
    assertNull(flow.finish(TrashAction.TRASH.requestCode, ok = true))
    assertTrue(flow.begin(TrashAction.TRASH, a, "p2"))
    assertNull(flow.resumed()) // the new request is not launched yet
  }

  @Test
  fun resumeBeforeLaunchDoesNot() {
    val flow = TrashFlow<String>()
    assertNull(flow.resumed())
    flow.begin(TrashAction.TRASH, a, "p")
    assertNull(flow.resumed())
    assertFalse(flow.begin(TrashAction.TRASH, a, "p2"))
    flow.launched()
    assertEquals("p", flow.finish(TrashAction.TRASH.requestCode, ok = true)?.first?.promise)
    assertNull(flow.resumed())
  }

  @Test
  fun answerCarriesTheUrisSent() {
    assertEquals(mapOf("moved" to 2, "uris" to a), trashAnswer(TrashAction.TRASH, a))
    assertEquals(mapOf("restored" to 0, "uris" to emptyList<String>()), trashAnswer(TrashAction.RESTORE, emptyList()))
  }
}
