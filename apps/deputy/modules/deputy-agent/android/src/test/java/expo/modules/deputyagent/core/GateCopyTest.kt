package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Test

class GateCopyTest {
  private fun gate(action: String, target: String?, draft: String? = null) =
    Gate("g", "r", GateKind.CONFIRM, "WhatsApp", action, target, draft, "because", emptyList(), 0)

  @Test fun aShortStepIsApprovableFromTheCollapsedRow() =
    assertEquals("Tap \"Delete\" in WhatsApp" to true, GateCopy.row(gate("Tap", "Delete")))

  @Test fun theRowShowsTheMessageAndOffersApproveOnlyWhenAllOfItFits() {
    assertEquals("Tap \"Send\" in WhatsApp: \"ok\"" to true, GateCopy.row(gate("Tap", "Send", draft = "ok")))
    assertEquals(false, GateCopy.row(gate("Tap", "Send", draft = "My code is 483920, send it to Ali")).second)
  }

  @Test fun aLinkTooLongToShowInFullIsNeverApprovableFromTheRow() =
    assertEquals(false, GateCopy.row(gate("Open link", "https://x.example/?d=contacts")).second)
}
