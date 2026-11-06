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
  fun unknownUidIsLabelled() {
    assertEquals("Unknown app", FirewallDecision.UNKNOWN_APP_LABEL)
  }

  @Test
  fun flowWithAnUnresolvedOwnerIsBlockedWhateverTheRule() {
    for (rule in FirewallRule.values()) {
      assertEquals(Verdict.BLOCK, FirewallDecision.flowVerdict(-1, rule, onCellular = false))
      assertEquals(Verdict.BLOCK, FirewallDecision.flowVerdict(-1, rule, onCellular = true))
    }
  }

  @Test
  fun flowWithAResolvedOwnerFollowsItsRule() {
    assertEquals(Verdict.ALLOW, FirewallDecision.flowVerdict(10123, FirewallRule.ALLOW, onCellular = true))
    assertEquals(Verdict.ALLOW, FirewallDecision.flowVerdict(0, FirewallRule.ALLOW, onCellular = false))
    assertEquals(Verdict.BLOCK, FirewallDecision.flowVerdict(10123, FirewallRule.BLOCK_ALWAYS, onCellular = false))
    assertEquals(Verdict.BLOCK, FirewallDecision.flowVerdict(10123, FirewallRule.BLOCK_ON_MOBILE, onCellular = true))
    assertEquals(Verdict.ALLOW, FirewallDecision.flowVerdict(10123, FirewallRule.BLOCK_ON_MOBILE, onCellular = false))
  }

  @Test
  fun dnsQueryOfABlockedAppIsBlocked() {
    assertEquals(Verdict.BLOCK, FirewallDecision.dnsVerdict(10123, FirewallRule.BLOCK_ALWAYS, onCellular = false))
    assertEquals(Verdict.BLOCK, FirewallDecision.dnsVerdict(10123, FirewallRule.BLOCK_ON_MOBILE, onCellular = true))
  }

  @Test
  fun dnsQueryOfAnAllowedAppIsAnswered() {
    assertEquals(Verdict.ALLOW, FirewallDecision.dnsVerdict(10123, FirewallRule.ALLOW, onCellular = true))
    assertEquals(Verdict.ALLOW, FirewallDecision.dnsVerdict(10123, FirewallRule.BLOCK_ON_MOBILE, onCellular = false))
  }

  @Test
  fun dnsQueryWithoutAnOwnerIsAnswered() {
    // The system resolver may not name the app; refusing those would take DNS away from every app.
    for (uid in listOf(null, "", "-1", "self", "rethink")) {
      val owner = FirewallDecision.dnsUid(uid)
      assertEquals(Verdict.ALLOW, FirewallDecision.dnsVerdict(owner, FirewallRule.BLOCK_ALWAYS, onCellular = true))
    }
  }

  @Test
  fun dnsRuleUidParsesTheDecimalUidFirestackPasses() {
    assertEquals(10123, FirewallDecision.dnsUid("10123"))
    assertEquals(-1, FirewallDecision.dnsUid("-1"))
    assertEquals(-1, FirewallDecision.dnsUid(null))
    assertEquals(-1, FirewallDecision.dnsUid("self"))
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
