package expo.modules.inflowcore.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The refresher itself is proven in BriefingRefresherTest; this pins the glue around it that needs a device: who builds it, what feeds it and who starts a rebuild.
class BriefingRefreshWiringTest {
  private val src = File("src/main/java/expo/modules/inflowcore")   // Gradle runs module unit tests from the module's android/ folder

  private fun text(name: String) = File(src, name).also { assertTrue("$name not found from ${File(".").absoluteFile}", it.isFile) }
    .readLines().filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") || it.trimStart().startsWith("/*") }.joinToString("\n")

  private fun kotlinFiles() = src.walk().filter { it.isFile && it.extension == "kt" && "/applink/" !in it.path }.toList()

  @Test fun theOneRefresherRunsOffTheCallersThreadAndIsBuiltOnce() {
    val t = text("android/BriefingRefresh.kt")
    assertEquals(1, Regex("Executors\\.newSingleThreadExecutor").findAll(t).count())
    assertTrue("a daemon thread of its own, never the capture or binder thread", t.contains("Thread(r, \"inflow-briefing\").apply { isDaemon = true }"))
    assertTrue(t.contains("instance ?: synchronized(this) { instance ?: create(context.applicationContext).also { instance = it } }"))
    assertEquals("only of() builds one", 1, Regex("BriefingRefresher\\(").findAll(t).count())
    assertEquals(listOf("BriefingRefresh.kt"), kotlinFiles().filter { Regex("(?<![A-Za-z])BriefingRefresher\\(").containsMatchIn(it.readText()) && it.name != "BriefingRefresher.kt" }.map { it.name })
  }

  @Test fun theSnapshotLivesInTheStoresMetaTheBuilderIsTheBriefingAndSharingOffIsWhatDisablesIt() {
    val t = text("android/BriefingRefresh.kt")
    assertTrue(t.contains("override fun read(): String? = store()?.meta(BriefingSnapshot.META)"))
    assertTrue(t.contains("if (json == null) s.deleteMeta(BriefingSnapshot.META) else s.setMeta(BriefingSnapshot.META, json)"))
    assertTrue(t.contains("store()?.let { Briefing.build(StoreBriefingInputs(it, app, ZoneId.systemDefault()), now, ZoneId.systemDefault()) }"))
    assertTrue("the switch is read from its own meta key, exactly", t.contains("{ Briefing.on(store()?.meta(Briefing.SHARE_META)) },"))
    assertTrue("a rebuild that changed the lines pings Halo through the one limiter", t.contains("{ HaloPing.changed(app) },"))
    assertTrue("a switch change goes through the refresher, whose order is tested", t.contains("fun settingChanged(context: Context) = of(context).settingChanged { HaloPing.changed(context) }"))
    assertTrue("the glue names no health code: health reaches the briefing only through StoreBriefingInputs", !t.contains("Health"))
  }

  @Test fun everyEntryThatStartsARebuildIsTheHeartbeatTheTwoSettersOrTheProvider() {
    val callers = kotlinFiles().filter { it.name != "BriefingRefresh.kt" }.flatMap { f ->
      Regex("BriefingRefresh\\.(\\w+)\\(").findAll(f.readText()).map { f.name to it.groupValues[1] }.toList()
    }
    assertEquals(
      listOf("AutopilotProvider.kt" to "of", "InflowCoreModule.kt" to "settingChanged", "InflowCoreModule.kt" to "settingChanged", "StoreHolder.kt" to "refresh"),
      callers.sortedWith(compareBy({ it.first }, { it.second })),
    )
  }

  @Test fun theHeartbeatRefreshesAndIsRunOnConnectOnCreateAndOnForeground() {
    assertTrue(text("android/StoreHolder.kt").substringAfter("fun heartbeat").substringBefore("fun storeError").contains("BriefingRefresh.refresh(app)"))
    assertTrue(text("android/InflowListener.kt").substringAfter("override fun onListenerConnected()").substringBefore("override fun onListenerDisconnected").contains("StoreHolder.heartbeat(applicationContext)"))
    val module = text("InflowCoreModule.kt")
    assertTrue(module.substringAfter("OnCreate {").substringBefore("OnActivityEntersForeground").contains("StoreHolder.heartbeat(context)"))
    assertTrue(module.substringAfter("OnActivityEntersForeground {").substringBefore("}").contains("StoreHolder.heartbeat(context)"))
  }

  @Test fun bothSwitchesSaveFirstThenTellTheRefresherAndTheGettersOnlyRead() {
    val module = text("InflowCoreModule.kt")
    fun fn(name: String) = module.substringAfter("Function(\"$name\")").substringBefore("Function(")
    for ((setter, meta) in listOf("setHealthInBriefing" to "Briefing.HEALTH_META", "setBriefingShare" to "Briefing.SHARE_META")) {
      val body = fn(setter)
      assertTrue(setter, body.contains("if (on) store().setMeta($meta, \"1\") else store().deleteMeta($meta)"))
      assertTrue("$setter saves before the refresher forgets and rebuilds", body.indexOf("setMeta") < body.indexOf("BriefingRefresh.settingChanged(context)"))
      assertEquals(setter, 1, Regex("BriefingRefresh\\.settingChanged").findAll(body).count())
    }
    assertTrue(fn("healthInBriefing").contains("Briefing.on(store().meta(Briefing.HEALTH_META))") && !fn("healthInBriefing").contains("BriefingRefresh"))
    assertTrue(fn("briefingShare").contains("Briefing.on(store().meta(Briefing.SHARE_META))") && !fn("briefingShare").contains("BriefingRefresh"))
  }

  @Test fun aProviderQueryStartsARebuildOnlyWhileSharingAndNeverRunsAReader() {
    val branch = text("android/AutopilotProvider.kt").substringAfter("BRIEFING -> MatrixCursor(BRIEFING_COLUMNS)").substringBefore("ASK_ITEMS ->")
    val serve = branch.indexOf("BriefingShare.serve(")
    val refresh = "if (shareOn) BriefingRefresh.of(ctx).maybeRefresh(snapshot)"
    assertTrue(branch, serve >= 0 && branch.contains(refresh) && serve < branch.indexOf(refresh))
    assertEquals("the query reads the cached snapshot, never a sibling", 0, Regex("StoreBriefingInputs|BriefingReaders|Briefing\\.build").findAll(branch).count())
    assertTrue(branch.contains("BriefingSnapshot.parse(store.meta(BriefingSnapshot.META))"))
  }
}
