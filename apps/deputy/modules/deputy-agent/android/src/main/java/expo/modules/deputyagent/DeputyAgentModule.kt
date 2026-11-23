package expo.modules.deputyagent

import android.app.Activity
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PersistableBundle
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognizerIntent
import expo.modules.deputyagent.android.AgentRuntime
import expo.modules.deputyagent.android.DeputyAccessibilityService
import expo.modules.deputyagent.android.KeyVault
import expo.modules.deputyagent.android.OwnerStore
import expo.modules.deputyagent.android.Schedules
import expo.modules.deputyagent.android.StopChip
import expo.modules.deputyagent.core.Begin
import expo.modules.deputyagent.core.Draft
import expo.modules.deputyagent.core.ProposalInbox
import expo.modules.deputyagent.core.SavedTask
import expo.modules.deputyagent.core.ServiceSetting
import expo.modules.deputyagent.core.SharedInbox
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

private const val NOT_CONNECTED =
  "The accessibility service isn't connected. If Setup says it is on, turn it off and on again in Accessibility settings."
private const val RUN_EVENT = "onRunEvent"
private const val SHARE_EVENT = "onShare"
private const val PROPOSAL_EVENT = "onProposal"
private const val SPEECH_REQUEST = 7301

class DeputyAgentModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private var pendingSpeech: Promise? = null

  private fun open(intent: Intent) = context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

  override fun definition() = ModuleDefinition {
    Name("DeputyAgent")

    Events(RUN_EVENT, SHARE_EVENT, PROPOSAL_EVENT)

    OnCreate {
      appContext.reactContext?.let(AgentRuntime::init)
      AgentRuntime.listener = { e -> sendEvent(RUN_EVENT, AgentRuntime.toMap(e)) }
      SharedInbox.listener = { sendEvent(SHARE_EVENT, emptyMap<String, Any>()) }
      ProposalInbox.listener = { sendEvent(PROPOSAL_EVENT, emptyMap<String, Any>()) }
      appContext.reactContext?.let(OwnerStore::heartbeat)
    }

    OnDestroy {
      AgentRuntime.listener = null
      SharedInbox.listener = null
      ProposalInbox.listener = null
    }

    Function("getServiceState") {
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
      mapOf(
        "accessibilityEnabled" to ServiceSetting.isEnabled(enabled, context.packageName, DeputyAccessibilityService::class.java.name),
        "notificationsAllowed" to context.getSystemService(NotificationManager::class.java).areNotificationsEnabled(),
        "batteryUnrestricted" to context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName),
        "keySet" to KeyVault.has(context, OwnerStore.settings(context)),
        "contactsAllowed" to (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) == android.content.pm.PackageManager.PERMISSION_GRANTED),
        "photosAllowed" to (context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES) == android.content.pm.PackageManager.PERMISSION_GRANTED),
        "runActive" to AgentRuntime.active,
      )
    }

    Function("openAccessibilitySettings") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }

    Function("openAppInfo") {
      open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }

    Function("openBatterySettings") { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }

    Function("disableService") { DeputyAccessibilityService.instance?.let { it.disableSelf(); true } ?: false }

    Function("startRun") { task: String, allowedApps: List<String>? ->
      try {
        mapOf("runId" to AgentRuntime.start(context, task, SavedTask.allowList(allowedApps)), "error" to null)
      } catch (e: IllegalStateException) {
        mapOf("runId" to null, "error" to e.message)
      }
    }
    Function("stopRun") { AgentRuntime.stop() }
    Function("resolveGate") { gateId: String, approve: Boolean, text: String? -> AgentRuntime.resolveGate(context, gateId, approve, text) }
    Function("getRun") { AgentRuntime.snapshot() }
    Function("listRuns") { limit: Int -> AgentRuntime.history(context, limit) }
    Function("getRunLog") { runId: String -> AgentRuntime.readRun(context, runId) }
    Function("deleteRun") { runId: String -> AgentRuntime.deleteRun(context, runId) }
    Function("clearHistory") { AgentRuntime.clearHistory(context) }

    AsyncFunction("listApps") { OwnerStore.apps(context) }
    AsyncFunction("setAppTrust") { pkg: String, level: String, typed: String? -> OwnerStore.setTrust(context, pkg, level, typed) }

    Function("getSettings") { OwnerStore.settings(context).toMap(System.currentTimeMillis()) }
    Function("knownModels") {
      expo.modules.deputyagent.core.Settings.KNOWN.map {
        mapOf(
          "name" to it.name, "baseUrl" to it.baseUrl, "model" to it.model, "images" to it.images,
          "inputPerM" to it.prices.inputPerM, "cachedPerM" to it.prices.cachedPerM, "outputPerM" to it.prices.outputPerM,
        )
      }
    }
    Function("setSettings") { input: Map<String, Any?> -> OwnerStore.saveSettings(context, input) }

    Function("listSavedTasks") { OwnerStore.tasks(context).map(OwnerStore::toMap) }
    Function("saveTask") { input: Map<String, Any?> -> OwnerStore.saveTask(context, input) }
    Function("deleteTask") { id: String -> OwnerStore.deleteTask(context, id) }

    Function("takeSharedText") {
      SharedInbox.take()?.let { mapOf("text" to it.text, "subject" to it.subject, "cut" to it.cut) }
    }
    Function("takeProposal") {
      ProposalInbox.take()?.let {
        mapOf("id" to it.id, "instruction" to it.task, "text" to it.context, "source" to it.source, "apps" to OwnerStore.appRefs(context, it.apps))
      }
    }
    Function("settleProposal") { id: String, kept: Boolean -> ProposalInbox.settle(id, kept) }
    Function("listDrafts") { OwnerStore.drafts(context).map { OwnerStore.draftMap(context, it) } }
    Function("saveDraft") { input: Map<String, Any?> -> OwnerStore.saveDraft(context, input) }
    Function("deleteDraft") { id: String -> OwnerStore.deleteDraft(context, id) }
    Function("startDraft") { input: Map<String, Any?> ->
      val r = try {
        val draft = OwnerStore.draftFrom(input)
        val trigger = if (draft.source != null) "proposed_task" else "shared_text"
        Draft.begin(draft) { task, apps, untrusted -> AgentRuntime.start(context, task, apps, untrusted, trigger = trigger) }
      } catch (e: IllegalArgumentException) {
        Begin.Failed(e.message ?: Draft.NO_TEXT)
      }
      when (r) {
        is Begin.Started -> mapOf("runId" to r.runId, "error" to null)
        is Begin.Failed -> mapOf("runId" to null, "error" to r.message)
      }
    }

    Function("getLinkShares") { OwnerStore.linkShares(context) }
    Function("setLinkShare") { name: String, on: Boolean -> OwnerStore.setLinkShare(context, name, on) }

    Function("listSchedules") { Schedules.list(context).map(Schedules::toMap) }
    Function("saveSchedule") { input: Map<String, Any?> -> Schedules.save(context, input) }
    Function("deleteSchedule") { id: String -> Schedules.delete(context, id) }
    Function("listScheduleRuns") { id: String -> Schedules.history(context, id) }

    Function("listApiKeys") { KeyVault.list(context, OwnerStore.settings(context)) }
    Function("addApiKey") { key: String -> KeyVault.add(context, key, OwnerStore.settings(context)) }
    Function("removeApiKey") { id: String -> KeyVault.remove(context, id) }
    AsyncFunction("testProvider") Coroutine { keyId: String -> AgentRuntime.testProvider(context, keyId) }

    Function("setPalette") { json: String -> StopChip.setPalette(json) }

    // The system speech dialog records the audio itself, so Deputy needs no microphone permission.
    AsyncFunction("listen") { prompt: String, promise: Promise ->
      pendingSpeech?.resolve(null)
      pendingSpeech = promise
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
      try {
        appContext.throwingActivity.startActivityForResult(intent, SPEECH_REQUEST)
      } catch (e: ActivityNotFoundException) {
        pendingSpeech = null
        promise.reject("ERR_NO_SPEECH", "This phone has no speech recognizer. Install or turn on the Google app, then try again.", e)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, result ->
      if (result.requestCode != SPEECH_REQUEST) return@OnActivityResult
      val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
      pendingSpeech?.resolve(if (result.resultCode == Activity.RESULT_OK) text else null)
      pendingSpeech = null
    }

    AsyncFunction("dumpForegroundTree") Coroutine { delaySeconds: Int ->
      delay(delaySeconds.coerceIn(0, 30) * 1000L)
      val service = DeputyAccessibilityService.instance
      val r = service?.let { withContext(Dispatchers.Default) { it.dumpForeground() } }
      mapOf(
        "pkg" to r?.pkg,
        "nodes" to (r?.nodes ?: 0),
        "text" to (r?.text ?: NOT_CONNECTED),
      )
    }

    Function("copyToClipboard") { text: String ->
      // Screen text can hold codes and messages: keep it out of the clipboard preview and keyboard history.
      val clip = ClipData.newPlainText("Deputy", text)
      clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
      context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
    }
  }
}
