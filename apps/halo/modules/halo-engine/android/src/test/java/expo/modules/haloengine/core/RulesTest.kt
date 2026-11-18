package expo.modules.haloengine.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RulesTest {
  private val none = SettingsRules(apps = emptyList(), fullscreen = false, landscape = false, calls = false, batterySaver = false, pocket = false)
  private fun idle() = RuleState(foregroundPkg = null, fullscreen = false, landscape = false, inCall = false, batterySaver = false, pocket = false)
  private fun all() = RuleState(foregroundPkg = "com.game", fullscreen = true, landscape = true, inCall = true, batterySaver = true, pocket = true)

  @Test
  fun noRulesNeverHides() {
    assertFalse(Rules.hidden(none, idle()))
    assertFalse(Rules.hidden(none, all()))
    assertFalse(Rules.hidden(SettingsRules(), idle()))
  }

  @Test
  fun eachRuleHides() {
    val cases = listOf<Pair<SettingsRules, (RuleState) -> Unit>>(
      none.copy(fullscreen = true) to { it.fullscreen = true },
      none.copy(landscape = true) to { it.landscape = true },
      none.copy(calls = true) to { it.inCall = true },
      none.copy(batterySaver = true) to { it.batterySaver = true },
      none.copy(pocket = true) to { it.pocket = true },
      none.copy(apps = listOf("com.game")) to { it.foregroundPkg = "com.game" },
    )
    for ((rules, set) in cases) {
      assertFalse("$rules idle", Rules.hidden(rules, idle()))
      assertTrue("$rules on", Rules.hidden(rules, idle().also(set)))
    }
  }

  @Test
  fun callHidesThenRestores() {
    val rules = SettingsRules()
    val st = idle()
    assertFalse(Rules.hidden(rules, st))
    st.inCall = true
    assertTrue(Rules.hidden(rules, st))
    st.inCall = false
    assertFalse(Rules.hidden(rules, st))
  }

  @Test
  fun appListMatchesForeground() {
    val rules = none.copy(apps = listOf("com.game", "com.video"))
    val st = idle()
    for (pkg in listOf(null, "com.other", "com.gam", "com.game.extra", "")) {
      st.foregroundPkg = pkg
      assertFalse("$pkg", Rules.hidden(rules, st))
    }
    for (pkg in listOf("com.game", "com.video")) {
      st.foregroundPkg = pkg
      assertTrue(pkg, Rules.hidden(rules, st))
    }
  }
}
