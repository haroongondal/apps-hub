package expo.modules.opentunnelnative

import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
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
private const val ERR_ENGINE_UNAVAILABLE = "ERR_ENGINE_UNAVAILABLE"
private const val ERR_SERVICE_START_FAILED = "ERR_SERVICE_START_FAILED"
private const val ERR_PROBE_FAILED = "ERR_PROBE_FAILED"

/** Validated tunnel config — handed to the service as JSON in the intent
 * extra. Never written to disk (privacy rule #5); `configText` reaches the
 * engine byte-for-byte. */
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

    OnDestroy {
      busListener?.let { TunnelEventBus.remove(it) }
      busListener = null
      moduleScope.cancel()
    }

    /**
     * Single TCP connect measurement for relay ranking. Connect refused is
     * a TCP RST from a live host and still carries the RTT (shared hard
     * rule); timeout/unreachable resolve null and the prober keeps the
     * static VPN Gate ping as fallback.
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

            // Gate G1 undecided: the OpenVPN path is a typed, explicit
            // failure — no stand-in state is ever produced.
            if (sniffed == VpnPayload.PROTOCOL_OPENVPN) {
              promise.reject(ERR_ENGINE_UNAVAILABLE, ServiceContracts.OPENVPN_GATE_MESSAGE, null)
              return@launch
            }

            // VPN consent first, before any foreground service work. The
            // system dialog is surfaced from here; the user retries start.
            val prepareIntent = VpnService.prepare(reactContext)
            if (prepareIntent != null) {
              reactContext.startActivity(
                prepareIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
              )
              promise.reject(
                ERR_SERVICE_START_FAILED,
                "Android VPN consent required — approve the system dialog, then start again",
                null,
              )
              return@launch
            }

            TunnelStateRegistry.setStatus(TunnelStatus.CONNECTING)
            TunnelEventBus.postStatus(TunnelStatus.CONNECTING, null)

            val serviceIntent = Intent().apply {
              setClassName(reactContext, ServiceContracts.SERVICE_CLASS_NAME)
              setAction(ServiceContracts.ACTION_START)
              putExtra(ServiceContracts.EXTRA_CONFIG, configJson(normalized))
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              reactContext.startForegroundService(serviceIntent)
            } else {
              reactContext.startService(serviceIntent)
            }
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
