package expo.modules.opentunnelnative.firewall

import expo.modules.opentunnelnative.TunnelStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FirewallContractTest {

  @Test
  fun theFirewallNeedsAndroid10() {
    assertFalse(FirewallContract.isSupported(24))
    assertFalse(FirewallContract.isSupported(28))
    assertTrue(FirewallContract.isSupported(29))
    assertTrue(FirewallContract.isSupported(36))
  }

  @Test
  fun aRuleIsParsedFromItsEnumName() {
    assertEquals(FirewallRule.BLOCK_ON_MOBILE, FirewallContract.parseRule("BLOCK_ON_MOBILE"))
    assertEquals(FirewallRule.ALLOW, FirewallContract.parseRule("ALLOW"))
    assertEquals(FirewallRule.BLOCK_ALWAYS, FirewallContract.parseRule("BLOCK_ALWAYS"))
  }

  @Test
  fun anythingElseIsNotARule() {
    assertNull(FirewallContract.parseRule("block_on_mobile"))
    assertNull(FirewallContract.parseRule(""))
    assertNull(FirewallContract.parseRule(null))
  }

  @Test
  fun theLogLimitIsBounded() {
    assertFalse(FirewallContract.isLogLimitValid(0))
    assertFalse(FirewallContract.isLogLimitValid(-5))
    assertTrue(FirewallContract.isLogLimitValid(1))
    assertTrue(FirewallContract.isLogLimitValid(FirewallContract.MAX_LOG_LIMIT))
    assertFalse(FirewallContract.isLogLimitValid(FirewallContract.MAX_LOG_LIMIT + 1))
  }

  @Test
  fun aSavedTrueIsStaleWhenTheFirewallProcessIsDead() {
    assertTrue(FirewallContract.isLive("true") { true })
    assertFalse(FirewallContract.isLive("true") { false })
    assertFalse(FirewallContract.isLive("false") { true })
    assertFalse(FirewallContract.isLive(null) { true })
  }

  @Test
  fun theProcessIsNotCheckedWhenNothingSaysTheFirewallIsUp() {
    var checked = false
    FirewallContract.isLive("false") { checked = true; true }
    assertFalse(checked)
  }

  @Test
  fun aServerConnectionHoldsTheSlotUntilItEnds() {
    assertFalse(FirewallContract.serverHoldsSlot(TunnelStatus.DISCONNECTED))
    assertFalse(FirewallContract.serverHoldsSlot(TunnelStatus.ERROR))
    assertTrue(FirewallContract.serverHoldsSlot(TunnelStatus.CONNECTING))
    assertTrue(FirewallContract.serverHoldsSlot(TunnelStatus.CONNECTED))
    assertTrue(FirewallContract.serverHoldsSlot(TunnelStatus.DISCONNECTING))
    assertTrue(FirewallContract.serverHoldsSlot(TunnelStatus.REASSERTING))
  }
}
