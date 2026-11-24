package expo.modules.inflowcore.android

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

// The reader rule and the sender rule (packages/app-link-contract/README.md): the glue asks AppLinkTarget before it reads or starts a sibling. The glue needs a device, so this pins the source text.
class SiblingTrustWiringTest {
  private val src = File("src/main/java/expo/modules/inflowcore")   // Gradle runs module unit tests from the module's android/ folder

  private fun text(name: String) = File(src, name).also { assertTrue("$name not found from ${File(".").absoluteFile}", it.isFile) }.readLines().filterNot { it.trimStart().startsWith("//") }.joinToString("\n")

  @Test fun askDeputyChecksTheTargetBeforeItStartsDeputy() {
    val body = text("android/SuggestionNotifier.kt").substringAfter("private fun askDeputy").substringBefore("private fun defaultLookIn")
    val gate = body.indexOf("AppLinkTarget.trustedActivity(ctx, i)")
    assertTrue("no trust check in askDeputy", gate >= 0)
    assertTrue("the check must come before the start", gate < body.indexOf("start(ctx, i"))
    assertTrue("a refusal must say not installed", body.substring(gate).substringBefore("\n").contains("return \"Deputy isn't installed.\""))
  }

  @Test fun payWithDeputyChecksTheTargetBeforeItLaunchesAndStartsAnExplicitIntent() {
    val module = text("InflowCoreModule.kt")
    val body = module.substringAfter("AsyncFunction(\"proposeToDeputy\")").substringBefore("Function(\"skipSuggestion\")")
    val gate = body.indexOf("ProposeToDeputy.run({ AppLinkTarget.trustedActivity(activity, intent) }, { proposeTask.launch(start) })")
    assertTrue("no trust check in proposeToDeputy", gate >= 0)
    assertTrue("proposeTask.launch must only be inside the gated run", Regex("""proposeTask\.launch\(""").findAll(module).count() == 1)
    val bill = text("android/ProposeBill.kt")
    assertTrue("the intent must be explicit", bill.contains("Intent(ProposeToDeputy.ACTION).setPackage(SiblingPackages.DEPUTY)"))
    assertTrue("the checked intent and the started one come from the same start", body.contains("val intent = start.intent()") && bill.contains("createIntent(context: Context, input: ProposeStart): Intent = input.intent()"))
    // The start is an Activity result launch only: no plain startActivity for Deputy, no service, no broadcast.
    assertTrue(!bill.contains("startActivity(") && !bill.contains("createChooser"))
    // The gate is inside the pure seam too: run refuses before it calls launch.
    val seam = text("core/ProposeToDeputy.kt").substringAfter("inline fun run(")
    assertTrue(seam.indexOf("if (!trusted()) return UNAVAILABLE") in 0 until seam.indexOf("launch()"))
  }

  @Test fun theBriefingAsksTheTargetBeforeEveryReaderQuery() {
    assertTrue(text("android/BriefingSource.kt").contains("AppLinkTarget.trustedProvider(context, authority, pkg)"))
    val readers = text("core/BriefingReaders.kt")
    assertTrue(readers.contains("trust.trusted(authority(r.uri), r.sibling) }.getOrDefault(false)) resolver.query(r.uri) else null"))
    // The only sibling reader is the briefing's: nothing else in the app queries a content:// share by a resolver.
    val others = src.walk().filter { it.isFile && it.extension == "kt" && "/applink/" !in it.path && it.name != "BriefingSource.kt" }.filter { Regex("""contentResolver\.query\(\s*Uri\.parse|resolver\.query\(\s*Uri\.parse""").containsMatchIn(it.readText()) }
    assertTrue(others.map { it.name }.toList().toString(), others.none())
  }

  @Test fun nothingElseStartsBindsOrBroadcastsWithoutTheTargetCheck() {
    val calls = Regex("""\b(sendBroadcast|sendOrderedBroadcast|bindService|startService|startForegroundService)\(""")
    val bare = src.walk().filter { it.isFile && it.extension == "kt" && "/applink/" !in it.path }.filter { f -> val t = f.readLines().filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") }.joinToString("\n"); calls.containsMatchIn(t) && !t.contains("AppLinkTarget.trusted") }
    assertTrue(bare.map { it.name }.toList().toString(), bare.none())
  }
}
