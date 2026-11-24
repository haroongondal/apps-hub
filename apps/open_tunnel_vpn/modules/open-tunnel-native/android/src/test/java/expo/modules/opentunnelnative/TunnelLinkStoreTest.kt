package expo.modules.opentunnelnative

import org.junit.Assert.assertEquals
import org.junit.Test

class TunnelLinkStoreTest {
  @Test fun refusesToSendWhenHaloIsNotTrusted() {
    var sent = 0
    TunnelLinkStore.sendIfTrusted({ false }) { sent++ }
    assertEquals(0, sent)
  }

  @Test fun sendsOnceWhenHaloIsTrusted() {
    var sent = 0
    TunnelLinkStore.sendIfTrusted({ true }) { sent++ }
    assertEquals(1, sent)
  }
}
