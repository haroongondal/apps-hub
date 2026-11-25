package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.Briefing
import expo.modules.inflowcore.core.HealthForAsk
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Health stays off until the owner turns it on: the two switches (health in Ask AI, health in the briefing and summary) and the Doctor summary, which has no switch but runs only on the owner's tap.
// The data-fence tests live in VitalsSqlWiringTest and HubRoutingTest; this pins who may turn a switch on, how the glue reads it, and that the briefing side never meets an AI call.
class HealthConsentWiringTest {
  private val src = File("src/main/java/expo/modules/inflowcore")   // Gradle runs module unit tests from the module's android/ folder

  private fun kotlin() = src.walk().filter { it.isFile && it.extension == "kt" && "/applink/" !in it.path }.toList()
    .also { assertTrue("sources not found from ${File(".").absoluteFile}", it.isNotEmpty()) }

  private fun code(f: File) = f.readLines().filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") || it.trimStart().startsWith("/*") }.joinToString("\n")

  private fun module() = code(File(src, "InflowCoreModule.kt"))

  private fun fn(name: String) = module().substringAfter("Function(\"$name\")").substringBefore("Function(")

  @Test fun everySwitchIsOffUnlessItsOwnKeyHoldsExactlyOne() {
    for (v in listOf(null, "", "0", "true", "on")) {
      assertFalse("Ask $v", HealthForAsk.on(v))
      assertFalse("Briefing $v", Briefing.on(v))
    }
    assertTrue(HealthForAsk.on("1") && Briefing.on("1"))
    // Two switches, two keys: turning one on never turns the other on.
    assertNotEquals(HealthForAsk.META, Briefing.HEALTH_META)
    assertNotEquals(Briefing.SHARE_META, Briefing.HEALTH_META)
  }

  @Test fun onlyTheModuleSettersTurnAHealthSwitchOnAndEachWritesItsOwnKey() {
    for ((setter, meta) in listOf("setHealthInAsk" to "HealthForAsk.META", "setHealthInBriefing" to "Briefing.HEALTH_META")) {
      assertTrue(setter, fn(setter).contains("if (on) store().setMeta($meta, \"1\") else store().deleteMeta($meta)"))
    }
    for (meta in listOf("HealthForAsk.META", "Briefing.HEALTH_META")) {
      val writers = kotlin().filter { f -> Regex("(setMeta|deleteMeta)\\(\\s*" + Regex.escape(meta)).containsMatchIn(code(f)) }.map { it.name }
      assertEquals(meta, listOf("InflowCoreModule.kt"), writers)
    }
    // The raw key strings are written down once each, in the constant; nobody saves or restores them by name.
    assertEquals(listOf("HealthForAsk.kt"), kotlin().filter { "\"healthInAsk\"" in code(it) && it.name != "InflowCoreModule.kt" }.map { it.name })
    assertEquals(listOf("Briefing.kt"), kotlin().filter { "\"healthInBriefing\"" in code(it) && it.name != "InflowCoreModule.kt" }.map { it.name })
  }

  @Test fun theGettersOnlyReadTheirOwnKeyAndEachKeyIsReadInTheOnePlaceThatActsOnIt() {
    assertTrue(fn("healthInAsk").contains("HealthForAsk.on(store().meta(HealthForAsk.META))"))
    for (g in listOf("healthInAsk", "healthInBriefing")) assertFalse(g, Regex("setMeta|deleteMeta").containsMatchIn(fn(g)))
    assertTrue(fn("healthInBriefing").contains("Briefing.on(store().meta(Briefing.HEALTH_META))"))
    fun readers(meta: String) = kotlin().filter { f -> Regex("meta\\(" + Regex.escape(meta) + "\\)").containsMatchIn(code(f)) }.map { it.name }.sorted()
    assertEquals(listOf("AiRunner.kt", "InflowCoreModule.kt"), readers("HealthForAsk.META"))
    assertEquals(listOf("AutopilotProvider.kt", "BriefingSource.kt", "InflowCoreModule.kt"), readers("Briefing.HEALTH_META"))
  }

  @Test fun theBriefingSideNeverMeetsAnAiCallAndTheAiSideNeverMeetsTheBriefing() {
    val ai = Regex("AiHubClient|HubAi|TextAi|AiConfig|AiRunner|HubChat|AskRun|AiRun\\b|ReportRun|TxnCategorize|DoctorRunner")
    val briefing = Regex("Briefing|(?<!Message)Digest|healthInBriefing")
    val briefingSide = listOf("Briefing.kt", "BriefingHealth.kt", "BriefingReaders.kt", "BriefingRefresher.kt", "BriefingSnapshot.kt", "Digest.kt", "ChangedPing.kt", "BriefingRefresh.kt", "BriefingSource.kt", "DigestAlarm.kt", "DigestNotifier.kt", "HaloPing.kt")
    val aiSide = listOf("Ai.kt", "AiQueue.kt", "AiProvider.kt", "AiSwitch.kt", "AskRun.kt", "Ask.kt", "HubAi.kt", "Reports.kt", "TxnCategorize.kt", "AiConfig.kt", "AiRunner.kt", "DoctorRunner.kt", "DoctorSummary.kt", "HealthForAsk.kt")
    val all = kotlin().associateBy { it.name }
    for (n in briefingSide) assertFalse("$n names an AI call", ai.containsMatchIn(code(all.getValue(n))))
    for (n in aiSide) assertFalse("$n names the briefing or summary", briefing.containsMatchIn(code(all.getValue(n))))
    // Health text in the briefing reaches a screen, the share and a notification, never the hub client, which only AiConfig builds.
    assertEquals(listOf("AiConfig.kt"), kotlin().filter { "AiHubClient(" in code(it) }.map { it.name })
  }

  @Test fun theDoctorSummaryNeedsTheOwnersHashAndHasNoOtherCaller() {
    val summarize = module().substringAfter("AsyncFunction(\"doctorSummarize\")").substringBefore("AsyncFunction(")
    assertTrue(summarize, summarize.contains("fromDay: String, toDay: String, include: Map<String, Any?>, hash: String"))
    assertTrue(summarize, summarize.contains("DoctorRunner.of(context, store()).summarize(fromDay, toDay, include, hash)"))
    assertEquals(listOf("InflowCoreModule.kt"), kotlin().filter { ".summarize(" in code(it) && it.name != "DoctorRunner.kt" }.map { it.name })
    // The runner refuses a hash that is not the preview's before it asks the hub (DoctorRunnerTest proves the refusal); here: the check comes first in the source.
    val runner = code(File(src, "android/DoctorRunner.kt")).substringAfter("fun summarize(")
    assertTrue(runner, runner.indexOf("if (p.hash != hash) return reply(null, CHANGED)") in 0 until runner.indexOf("ai.complete("))
  }
}
