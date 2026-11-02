package expo.modules.opentunnelnative

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.opentunnelnative.firewall.DataUseReader
import expo.modules.opentunnelnative.firewall.FirewallContract
import expo.modules.opentunnelnative.firewall.FirewallRule
import expo.modules.opentunnelnative.firewall.FirewallStore
import expo.modules.opentunnelnative.firewall.LogFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val EVENT_STATUS_CHANGED = "onStatusChanged"
private const val EVENT_TRAFFIC_UPDATE = "onTrafficUpdate"

private const val ERR_INVALID_CONFIG = "ERR_INVALID_CONFIG"
private const val ERR_INVALID_PARAMS = "ERR_INVALID_PARAMS"
private const val ERR_NO_CONTEXT = "ERR_NO_CONTEXT"
private const val ERR_SERVICE_START_FAILED = "ERR_SERVICE_START_FAILED"
private const val ERR_PROBE_FAILED = "ERR_PROBE_FAILED"
private const val ERR_FIREWALL_NOT_SUPPORTED = "ERR_FIREWALL_NOT_SUPPORTED"
private const val ERR_FIREWALL_FAILED = "ERR_FIREWALL_FAILED"
private const val VPN_CONSENT_REQUEST = 0x0715

/** shortcut: a fixed 30-day window for data use, a picker would be new UI. */
private const val DATA_USE_WINDOW_MS = 30L * 24 * 60 * 60 * 1000

/** Validated tunnel config — handed to the service as JSON in the intent
 * extra; `configText` reaches the engine byte-for-byte. The module never
 * writes it to disk (privacy rule #5); see OpenVpnEngine for ics-openvpn's
 * own profile file, which it deletes. */
internal data class NormalizedTunnelConfig(
  val nodeId: String,
  val serverIp: String,
  val serverPort: Int,
  val protocol: String,
  val configText: String,
  val dnsServers: List<String>,
  val enableKillSwitch: Boolean,
  val disallowedApps: List<String>,
)

/** A VPN consent dialog in flight: [start] runs once Android allows the VPN, [what] names it in errors. */
private class PendingConsent(
  val promise: Promise,
  val what: String,
  val deniedMessage: String,
  val start: () -> Unit,
)

internal sealed interface ConfigParseResult {
  data class Ok(val config: NormalizedTunnelConfig) : ConfigParseResult
  data class Invalid(val message: String) : ConfigParseResult
}

/**
 * Expo Modules API bridge for the OpenTunnel VPN host (plan §4.2). Factory
 * pattern follows `netlens-core`: blocking work runs on dedicated coroutine
 * dispatchers, and every emitted event is marshalled onto the main thread
 * before it reaches JS.
 */
class OpenTunnelNativeModule : Module() {

  private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var busListener: TunnelEventBus.Listener? = null
  @Volatile
  private var pendingConsent: PendingConsent? = null

  @Volatile
  private var firewallStoreInstance: FirewallStore? = null

  private fun startTunnelService(config: NormalizedTunnelConfig) {
    val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
    TunnelStateRegistry.setStatus(TunnelStatus.CONNECTING)
    TunnelEventBus.postStatus(TunnelStatus.CONNECTING, null)
    val serviceIntent = Intent().apply {
      setClassName(context, ServiceContracts.SERVICE_CLASS_NAME)
      setAction(ServiceContracts.ACTION_START)
      putExtra(ServiceContracts.EXTRA_CONFIG, configJson(config))
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(serviceIntent)
    } else {
      context.startService(serviceIntent)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("OpenTunnelNative")

    Events(EVENT_STATUS_CHANGED, EVENT_TRAFFIC_UPDATE)

    OnStartObserving {
      val listener = object : TunnelEventBus.Listener {
        override fun onStatus(state: String, message: String?) {
          moduleScope.launch {
            postEvent(
              EVENT_STATUS_CHANGED,
              mapOf("state" to state, "message" to message),
            )
          }
        }

        override fun onTraffic(bytesIn: Long, bytesOut: Long, connectedDurationSec: Long) {
          moduleScope.launch {
            postEvent(
              EVENT_TRAFFIC_UPDATE,
              mapOf(
                "bytesIn" to bytesIn,
                "bytesOut" to bytesOut,
                "connectedDurationSec" to connectedDurationSec,
              ),
            )
          }
        }
      }
      busListener = listener
      TunnelEventBus.add(listener)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != VPN_CONSENT_REQUEST) return@OnActivityResult
      val pending = pendingConsent ?: return@OnActivityResult
      pendingConsent = null
      if (payload.resultCode != Activity.RESULT_OK) {
        pending.promise.reject(ERR_SERVICE_START_FAILED, pending.deniedMessage, null)
        return@OnActivityResult
      }
      // The firewall start saves its switch to SQLite, so the continuation runs off the main thread.
      moduleScope.launch(Dispatchers.IO) {
        try {
          pending.start()
          pending.promise.resolve(null)
        } catch (error: Exception) {
          pending.promise.reject(ERR_SERVICE_START_FAILED, "${pending.what} start failed: ${error.javaClass.name}", error)
        }
      }
    }

    OnDestroy {
      busListener?.let { TunnelEventBus.remove(it) }
      busListener = null
      moduleScope.cancel()
    }

    /**
     * Single TCP connect measurement for relay ranking. Refused, timeout
     * and unreachable all resolve null (a refused relay port means the relay
     * is down); the prober keeps the static VPN Gate ping as fallback.
     */
    AsyncFunction("tcpProbe") { ip: String, port: Int, timeoutMs: Int, promise: Promise ->
      if (port !in 1..65535) {
        promise.reject(ERR_INVALID_PARAMS, "port must be 1..65535", null)
      } else if (timeoutMs !in 1..15000) {
        promise.reject(ERR_INVALID_PARAMS, "timeoutMs must be 1..15000", null)
      } else {
        moduleScope.launch {
          try {
            val rttMs = withContext(Dispatchers.IO) {
              NativeTcpProbe.connect(ip.trim(), port, timeoutMs)
            }
            promise.resolve(rttMs)
          } catch (error: kotlinx.coroutines.CancellationException) {
            promise.reject(ERR_PROBE_FAILED, "TCP probe cancelled", error)
          } catch (error: Exception) {
            promise.reject(
              ERR_PROBE_FAILED,
              "TCP probe failed (transport): ${error.javaClass.name}",
              error,
            )
          }
        }
      }
    }

    /**
     * Handed-off tunnel start (plan §4.1 "resolves once handed to the
     * service"): validates the payload, routes by protocol sniff,
     * requires the VPN consent up front, then starts the FGS host.
     */
    AsyncFunction("startTunnel") { config: Map<String, Any?>, promise: Promise ->
      val reactContext = appContext.reactContext
      if (reactContext == null) {
        promise.reject(ERR_NO_CONTEXT, "React context unavailable", null)
      } else {
        moduleScope.launch {
          try {
            val normalized = when (val parse = parseTunnelConfig(config)) {
              is ConfigParseResult.Invalid -> {
                promise.reject(ERR_INVALID_CONFIG, parse.message, null)
                return@launch
              }
              is ConfigParseResult.Ok -> parse.config
            }

            // Protocol routing is payload-derived (AGENTS rule #1): the
            // declared protocol must agree with the sniffed payload.
            val sniffed = VpnPayload.detectProtocol(normalized.configText)
            if (sniffed != normalized.protocol) {
              promise.reject(
                ERR_INVALID_CONFIG,
                "declared protocol ${normalized.protocol} does not match the $sniffed payload",
                null,
              )
              return@launch
            }

            // VPN consent first, from the current activity so the dialog
            // stays on top; OnActivityResult continues the start.
            val prepareIntent = VpnService.prepare(reactContext)
            if (prepareIntent != null) {
              askVpnConsent(
                prepareIntent,
                PendingConsent(promise, "tunnel", "Android didn't allow the VPN. Tap a server to try again.") {
                  startTunnelService(normalized)
                },
                "Open TunnelWall and tap the server again.",
              )
              return@launch
            }

            startTunnelService(normalized)
            promise.resolve(null)
          } catch (error: Exception) {
            promise.reject(
              ERR_SERVICE_START_FAILED,
              "tunnel start failed: ${error.javaClass.name}",
              error,
            )
          }
        }
      }
    }

    AsyncFunction("stopTunnel") { promise: Promise ->
      val reactContext = appContext.reactContext
      if (reactContext == null) {
        promise.reject(ERR_NO_CONTEXT, "React context unavailable", null)
      } else {
        moduleScope.launch {
          try {
            TunnelStateRegistry.setStatus(TunnelStatus.DISCONNECTING)
            TunnelEventBus.postStatus(TunnelStatus.DISCONNECTING, null)

            val intent = Intent().apply {
              setClassName(reactContext, ServiceContracts.SERVICE_CLASS_NAME)
              setAction(ServiceContracts.ACTION_STOP)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              reactContext.startForegroundService(intent)
            } else {
              reactContext.startService(intent)
            }
            promise.resolve(null)
          } catch (error: Exception) {
            promise.reject(
              ERR_SERVICE_START_FAILED,
              "tunnel stop failed: ${error.javaClass.name}",
              error,
            )
          }
        }
      }
    }

    AsyncFunction("getState") { promise: Promise ->
      promise.resolve(TunnelStateRegistry.statusState)
    }

    /**
     * Deep link to the system VPN sheet (Always-On + Block-without-VPN
     * toggles live there). Resolves whether opening actually worked — a
     * denial of POST_NOTIFICATIONS has no bearing on this.
     */
    AsyncFunction("openSystemVpnSettings") { promise: Promise ->
      val reactContext = appContext.reactContext
      if (reactContext == null) {
        promise.reject(ERR_NO_CONTEXT, "React context unavailable", null)
      } else {
        val intent =
          Intent(Settings.ACTION_VPN_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        var started = false
        try {
          reactContext.startActivity(intent)
          started = true
        } catch (error: Exception) {
          started = false
        }
        promise.resolve(started)
      }
    }

    AsyncFunction("getFirewallStatus") { promise: Promise ->
      firewall(promise) { context ->
        val store = firewallStore(context)
        promise.resolve(
          mapOf(
            "enabled" to (store.readState(FirewallContract.STATE_ENABLED) == "true"),
            "running" to firewallLive(store, context, FirewallContract.STATE_RUNNING),
            "paused" to firewallLive(store, context, FirewallContract.STATE_PAUSED),
            "usageAccess" to DataUseReader.hasUsageAccess(context),
          ),
        )
      }
    }

    /**
     * The switch is saved before the start intent (the service's implicit-start gate reads it), and a
     * start waits for the VPN consent. A server connection owns the VPN slot, so the start is refused then.
     */
    AsyncFunction("setFirewallEnabled") { on: Boolean, promise: Promise ->
      firewall(promise) { context ->
        val store = firewallStore(context)
        if (!on) {
          store.writeState(FirewallContract.STATE_ENABLED, "false")
          sendToFirewall(context, FirewallContract.ACTION_STOP)
          promise.resolve(null)
          return@firewall
        }
        if (rejectIfServerConnected(promise)) return@firewall
        val start = {
          store.writeState(FirewallContract.STATE_ENABLED, "true")
          try {
            sendToFirewall(context, FirewallContract.ACTION_START)
          } catch (error: Exception) {
            // A start that never left must not leave the switch on: an Always-on start would run the firewall later.
            runCatching { store.writeState(FirewallContract.STATE_ENABLED, "false") }.onFailure(error::addSuppressed)
            throw error
          }
        }
        val prepareIntent = VpnService.prepare(context)
        if (prepareIntent == null) {
          start()
          promise.resolve(null)
        } else {
          askVpnConsent(
            prepareIntent,
            PendingConsent(promise, "firewall", "Android didn't allow the VPN. Turn the firewall on to try again.", start),
            "Open TunnelWall and turn the firewall on again.",
          )
        }
      }
    }

    AsyncFunction("setPaused") { paused: Boolean, promise: Promise ->
      firewall(promise) { context ->
        val store = firewallStore(context)
        if (paused) {
          if (firewallLive(store, context, FirewallContract.STATE_RUNNING)) {
            sendToFirewall(context, FirewallContract.ACTION_PAUSE)
          }
        } else if (firewallLive(store, context, FirewallContract.STATE_PAUSED)) {
          if (rejectIfServerConnected(promise)) return@firewall
          sendToFirewall(context, FirewallContract.ACTION_RESUME)
        }
        promise.resolve(null)
      }
    }

    /** Every installed app that can use the network, one entry per UID, with its rule (allow when it has none). */
    AsyncFunction("getAppRules") { promise: Promise ->
      firewall(promise) { context ->
        promise.resolve(installedAppRules(context, firewallStore(context).rules()))
      }
    }

    AsyncFunction("setAppRule") { uid: Int, rule: String, promise: Promise ->
      firewall(promise) { context ->
        val parsed = FirewallContract.parseRule(rule)
        if (uid < 0 || parsed == null) {
          promise.reject(ERR_INVALID_PARAMS, "uid must be 0 or more and rule must be a firewall rule name", null)
          return@firewall
        }
        val store = firewallStore(context)
        val pkg = context.packageManager.getPackagesForUid(uid)?.firstOrNull() ?: "uid:$uid"
        store.setRule(uid, pkg, parsed)
        if (firewallLive(store, context, FirewallContract.STATE_RUNNING)) {
          sendToFirewall(context, FirewallContract.ACTION_RELOAD)
        }
        promise.resolve(null)
      }
    }

    AsyncFunction("getActivityLog") { uid: Int?, blockedOnly: Boolean, limit: Int, promise: Promise ->
      firewall(promise) { context ->
        if (!FirewallContract.isLogLimitValid(limit)) {
          promise.reject(ERR_INVALID_PARAMS, "limit must be 1..${FirewallContract.MAX_LOG_LIMIT}", null)
          return@firewall
        }
        promise.resolve(
          firewallStore(context).log(LogFilter(uid, blockedOnly), limit).map {
            mapOf(
              "timestampMs" to it.timestampMs,
              "uid" to it.uid,
              "pkg" to it.pkg,
              "proto" to it.proto,
              "dst" to it.dst,
              "dstPort" to it.dstPort,
              "domain" to it.domain,
              "bytesOut" to it.bytesOut,
              "bytesIn" to it.bytesIn,
              "verdict" to it.verdict.name,
            )
          },
        )
      }
    }

    AsyncFunction("clearActivityLog") { promise: Promise ->
      firewall(promise) { context ->
        firewallStore(context).clearLog()
        promise.resolve(null)
      }
    }

    /** Empty without the Usage access grant (the status says whether it is held), never invented rows. */
    AsyncFunction("getDataUse") { promise: Promise ->
      firewall(promise) { context ->
        val rows = if (DataUseReader.hasUsageAccess(context)) {
          val now = System.currentTimeMillis()
          DataUseReader.rows(DataUseReader.query(context, now - DATA_USE_WINDOW_MS, now))
        } else {
          emptyList()
        }
        promise.resolve(rows.map { mapOf("uid" to it.uid, "wifiBytes" to it.wifiBytes, "cellBytes" to it.cellBytes) })
      }
    }

    AsyncFunction("openUsageAccessSettings") { promise: Promise ->
      firewall(promise) { context ->
        context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve(null)
      }
    }
  }

  /**
   * Runs one firewall call off the main thread behind the Android 10 gate (the firewall's app
   * attribution starts there). A thrown failure is a typed reject, never an untyped bridge error.
   */
  private fun firewall(promise: Promise, block: suspend (Context) -> Unit) {
    if (!FirewallContract.isSupported(Build.VERSION.SDK_INT)) {
      promise.reject(ERR_FIREWALL_NOT_SUPPORTED, "The firewall needs Android 10 or newer.", null)
      return
    }
    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      promise.reject(ERR_NO_CONTEXT, "React context unavailable", null)
      return
    }
    moduleScope.launch(Dispatchers.IO) {
      try {
        block(context)
      } catch (error: Exception) {
        promise.reject(ERR_FIREWALL_FAILED, "firewall call failed: ${error.javaClass.name}", error)
      }
    }
  }

  private fun firewallStore(context: Context): FirewallStore =
    firewallStoreInstance ?: synchronized(this) {
      firewallStoreInstance ?: FirewallStore(context).also { firewallStoreInstance = it }
    }

  /** The `firewall_state` flag is true only while the `:firewall` process is alive. */
  private fun firewallLive(store: FirewallStore, context: Context, key: String): Boolean =
    FirewallContract.isLive(store.readState(key)) {
      val process = "${context.packageName}:firewall"
      context.getSystemService(ActivityManager::class.java).runningAppProcesses?.any { it.processName == process } == true
    }

  /** Every firewall action goes through startForegroundService: the service calls startForeground first. */
  private fun sendToFirewall(context: Context, action: String) {
    context.startForegroundService(
      Intent().apply {
        setClassName(context, FirewallContract.SERVICE_CLASS_NAME)
        setAction(action)
      },
    )
  }

  /** True after rejecting: a firewall start would take the VPN slot from the server connection. */
  private fun rejectIfServerConnected(promise: Promise): Boolean {
    if (!FirewallContract.serverHoldsSlot(TunnelStateRegistry.statusState)) return false
    promise.reject(
      ERR_SERVICE_START_FAILED,
      "The firewall can't start while you're connected to a VPN server. Disconnect, then try again.",
      null,
    )
    return true
  }

  @Suppress("DEPRECATION")
  private fun installedAppRules(context: Context, rules: Map<Int, FirewallRule>): List<Map<String, Any?>> {
    val pm = context.packageManager
    val byUid = LinkedHashMap<Int, Map<String, Any?>>()
    for (app in pm.getInstalledApplications(0)) {
      if (app.uid in byUid) continue
      if (pm.checkPermission(Manifest.permission.INTERNET, app.packageName) != PackageManager.PERMISSION_GRANTED) continue
      byUid[app.uid] = mapOf(
        "uid" to app.uid,
        "pkg" to app.packageName,
        "label" to pm.getApplicationLabel(app).toString(),
        "rule" to (rules[app.uid] ?: FirewallRule.ALLOW).name,
      )
    }
    return byUid.values.toList()
  }

  /**
   * Shows the VPN consent dialog from the current activity; [pending] continues from OnActivityResult.
   * A request still waiting is rejected as replaced.
   */
  private suspend fun askVpnConsent(prepareIntent: Intent, pending: PendingConsent, noActivityMessage: String) {
    val activity = appContext.currentActivity
    if (activity == null) {
      pending.promise.reject(ERR_NO_CONTEXT, noActivityMessage, null)
      return
    }
    pendingConsent?.promise?.reject(ERR_SERVICE_START_FAILED, "Replaced by a newer connect request.", null)
    pendingConsent = pending
    withContext(Dispatchers.Main) {
      activity.startActivityForResult(prepareIntent, VPN_CONSENT_REQUEST)
    }
  }

  /** Deliver events on the main thread (service callbacks originate off it). */
  private suspend fun postEvent(name: String, payload: Map<String, Any?>) =
    withContext(Dispatchers.Main) {
      sendEvent(name, payload)
    }

  /** Strict contract-field validation (plan §4.1). Unknown extra keys are
   * tolerated; missing/mistyped required fields are a typed rejection. */
  private fun parseTunnelConfig(raw: Map<String, Any?>): ConfigParseResult {
    val nodeId = raw["nodeId"] as? String ?: return ConfigParseResult.Invalid("nodeId missing")
    if (nodeId.isBlank()) return ConfigParseResult.Invalid("nodeId missing")

    val serverIp = raw["serverIp"] as? String ?: return ConfigParseResult.Invalid("serverIp missing")
    if (serverIp.isBlank()) return ConfigParseResult.Invalid("serverIp missing")

    val serverPortRaw = raw["serverPort"] as? Number
      ?: return ConfigParseResult.Invalid("serverPort missing")
    val serverPort = serverPortRaw.toInt()
    if (serverPort !in 1..65535) {
      return ConfigParseResult.Invalid("serverPort must be 1..65535")
    }

    val protocol = raw["protocol"] as? String ?: return ConfigParseResult.Invalid("protocol missing")
    if (protocol != VpnPayload.PROTOCOL_OPENVPN && protocol != VpnPayload.PROTOCOL_WIREGUARD) {
      return ConfigParseResult.Invalid("unknown protocol $protocol")
    }

    val configText =
      raw["configText"] as? String ?: return ConfigParseResult.Invalid("configText missing")
    if (configText.isBlank()) return ConfigParseResult.Invalid("configText empty")

    val dnsServers = stringList(raw, "dnsServers")
      ?: return ConfigParseResult.Invalid("dnsServers must be a list of strings")

    val enableKillSwitch =
      raw["enableKillSwitch"] as? Boolean
        ?: return ConfigParseResult.Invalid("enableKillSwitch must be boolean")

    val disallowedApps = stringList(raw, "disallowedApps")
      ?: return ConfigParseResult.Invalid("disallowedApps must be a list of strings")

    return ConfigParseResult.Ok(
      NormalizedTunnelConfig(
        nodeId = nodeId.trim(),
        serverIp = serverIp.trim(),
        serverPort = serverPort,
        protocol = protocol,
        configText = configText,
        dnsServers = dnsServers,
        enableKillSwitch = enableKillSwitch,
        disallowedApps = disallowedApps,
      ),
    )
  }

  private fun stringList(raw: Map<String, Any?>, key: String): List<String>? {
    val values = raw[key] as? List<*> ?: return null
    return values.map { value ->
      (value as? String)?.trim() ?: return null
    }
  }

  /** JSON-serializes the validated config for the intent extra. */
  private fun configJson(config: NormalizedTunnelConfig): String {
    val json = JSONObject()
    json.put("nodeId", config.nodeId)
    json.put("serverIp", config.serverIp)
    json.put("serverPort", config.serverPort)
    json.put("protocol", config.protocol)
    json.put("configText", config.configText)
    json.put("dnsServers", JSONArray(config.dnsServers))
    json.put("enableKillSwitch", config.enableKillSwitch)
    json.put("disallowedApps", JSONArray(config.disallowedApps))
    return json.toString()
  }
}
