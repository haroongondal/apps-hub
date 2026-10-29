package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VerbMatcherTest {
  @Test fun matchesAWholeWordInAnyCase() {
    assertEquals("send", VerbMatcher.match("SEND"))
    assertEquals("pay", VerbMatcher.match("Pay now"))
    assertEquals("delete", VerbMatcher.match("Delete, 3 items"))
    assertEquals("approve", VerbMatcher.match("Approve sign-in"))
  }

  @Test fun ignoresAVerbInsideALongerWord() {
    assertNull(VerbMatcher.match("Sender"))
    assertNull(VerbMatcher.match("Display"))
    assertNull(VerbMatcher.match("Booked"))
  }

  @Test fun matchesMultiWordVerbsOnlyAsAPhrase() {
    assertEquals("sign out", VerbMatcher.match("Sign out of this account"))
    assertEquals("log out", VerbMatcher.match("log  out"))
    assertNull(VerbMatcher.match("Sign in"))
    assertNull(VerbMatcher.match("Out of sign"))
  }

  @Test fun splitsViewIdsAndCamelCaseButNotThePackage() {
    assertEquals("send", VerbMatcher.match("com.whatsapp:id/send"))
    assertEquals("send", VerbMatcher.match("com.app:id/btnSend"))
    assertEquals("submit", VerbMatcher.match("submit_button"))
    assertNull(VerbMatcher.match("com.example.share:id/title"))
  }

  @Test fun checksTextDescriptionHintAndViewIdOfANode() {
    fun n(text: String? = null, desc: String? = null, hint: String? = null, viewId: String? = null) =
      NodeRef("p", text, desc, hint, viewId, Bounds(0, 0, 10, 10), clickable = true)
    assertEquals("send", VerbMatcher.match(n(text = "Send")))
    assertEquals("buy", VerbMatcher.match(n(desc = "Buy now")))
    assertEquals("reply", VerbMatcher.match(n(hint = "Reply")))
    assertEquals("delete", VerbMatcher.match(n(viewId = "p:id/delete_icon")))
    assertNull(VerbMatcher.match(n(text = "Inbox", desc = "Folder", viewId = "p:id/inbox")))
  }

  @Test fun readsALabelLiftedFromChildren() = assertEquals(
    "delete",
    VerbMatcher.match(NodeRef("p", null, null, null, null, Bounds(0, 0, 10, 10), clickable = true, childText = "Delete account")),
  )
}
