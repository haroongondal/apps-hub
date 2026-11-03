package expo.modules.opentunnelnative.firewall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FirewallDecisionTest {

  @Test
  fun allowAlwaysAllows() {
    assertEquals(Verdict.ALLOW, FirewallDecision.verdict(FirewallRule.ALLOW, onCellular = false))
    assertEquals(Verdict.ALLOW, FirewallDecision.verdict(FirewallRule.ALLOW, onCellular = true))
  }

  @Test
  fun blockOnMobileBlocksOnlyOnCellular() {
    assertEquals(Verdict.BLOCK, FirewallDecision.verdict(FirewallRule.BLOCK_ON_MOBILE, onCellular = true))
    assertEquals(Verdict.ALLOW, FirewallDecision.verdict(FirewallRule.BLOCK_ON_MOBILE, onCellular = false))
  }

  @Test
  fun blockAlwaysBlocksEverywhere() {
    assertEquals(Verdict.BLOCK, FirewallDecision.verdict(FirewallRule.BLOCK_ALWAYS, onCellular = false))
    assertEquals(Verdict.BLOCK, FirewallDecision.verdict(FirewallRule.BLOCK_ALWAYS, onCellular = true))
  }

  @Test
  fun unknownUidIsAllowedAndLabelled() {
    // The caller resolves the UID; an unknown one gets Verdict.ALLOW and this label.
    assertEquals("Unknown app", FirewallDecision.UNKNOWN_APP_LABEL)
  }

  @Test
  fun blockedRuleClosesOpenConnections() {
    assertTrue(FirewallDecision.shouldCloseOpen(FirewallRule.BLOCK_ALWAYS, onCellular = false))
    assertTrue(FirewallDecision.shouldCloseOpen(FirewallRule.BLOCK_ON_MOBILE, onCellular = true))
    assertFalse(FirewallDecision.shouldCloseOpen(FirewallRule.BLOCK_ON_MOBILE, onCellular = false))
    assertFalse(FirewallDecision.shouldCloseOpen(FirewallRule.ALLOW, onCellular = false))
    assertFalse(FirewallDecision.shouldCloseOpen(FirewallRule.ALLOW, onCellular = true))
  }
}
