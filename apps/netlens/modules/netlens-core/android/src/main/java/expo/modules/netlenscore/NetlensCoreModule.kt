package expo.modules.netlenscore

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val EVENT_HOST_DISCOVERED = "onHostDiscovered"
private const val EVENT_SCAN_COMPLETE = "onScanComplete"
private const val EVENT_SERVICE_DISCOVERED = "onServiceDiscovered"
private const val EVENT_SERVICE_COMPLETE = "onServiceScanComplete"

private const val ERR_SCAN_IN_PROGRESS = "SCAN_IN_PROGRESS"
private const val ERR_NO_CONTEXT = "NO_CONTEXT"
private const val ERR_INVALID_PARAMS = "INVALID_PARAMS"
private const val ERR_INVALID_HOSTNAME = "INVALID_HOSTNAME"

/**
 * Expo Modules API wrapper for the NetLens networking engine.
 * All blocking work happens on dedicated coroutine dispatchers; events are
 * marshalled onto the main thread before reaching JS.
 */
class NetlensCoreModule : Module() {
  private val moduleScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var tcpScanJob: kotlinx.coroutines.Job? = null
  private var serviceJob: kotlinx.coroutines.Job? = null

  override fun definition() = ModuleDefinition {
    Name("NetLensCore")

    Events(
      EVENT_HOST_DISCOVERED,
      EVENT_SCAN_COMPLETE,
      EVENT_SERVICE_DISCOVERED,
      EVENT_SERVICE_COMPLETE,
    )

    OnStartObserving { }

    AsyncFunction("getNetworkInterfaceInfo") { promise: Promise ->
      moduleScope.launch {
        try {
          val info = PlatformNetwork.detect(resolvedContext())
          if (info == null) {
            promise.resolve(null)
          } else {
            promise.resolve(
              mapOf(
                "localIp" to info.localIp,
                "cidrPrefix" to info.cidrPrefix,
                "gatewayIp" to info.gatewayIp,
              ),
            )
          }
        } catch (error: Exception) {
          promise.reject("INTERFACE_DETECT_FAILED", error.message, error)
        }
      }
    }

    AsyncFunction("startTcpScan") { hostIps: List<String>, ports: List<Int>, timeoutMs: Int, promise: Promise ->
      val existing = tcpScanJob
      if (existing != null && existing.isActive) {
        promise.reject(ERR_SCAN_IN_PROGRESS, "A TCP scan is already running", null)
      } else {
        val effectivePorts = if (ports.isEmpty()) TcpProbe.DEFAULT_PORTS else ports
        val newSocket = PlatformNetwork.socketFactoryFor(resolvedContext(), hostIps.firstOrNull().orEmpty())
        tcpScanJob = moduleScope.launch {
          try {
            val stats = TcpSweepEngine(
              hostIps = hostIps,
              ports = effectivePorts,
              timeoutMs = timeoutMs,
              newSocket = newSocket,
            ) { host ->
              postEvent(
                EVENT_HOST_DISCOVERED,
                mapOf(
                  "ip" to host.ip,
                  "isReachable" to TcpProbe.isReachable(host.outcome),
                  "rttMs" to host.rttMs,
                  "winningPort" to host.winningPort,
                  "outcome" to host.outcome.name.lowercase(),
                ),
              )
            }.run()
            postEvent(
              EVENT_SCAN_COMPLETE,
              mapOf(
                "durationMs" to stats.durationMs,
                "totalProbed" to stats.totalProbed,
                "hostsFound" to stats.hostsFound,
                "cancelled" to false,
              ),
            )
            promise.resolve(true)
          } catch (error: CancellationException) {
            postEvent(
              EVENT_SCAN_COMPLETE,
              mapOf(
                "durationMs" to null,
                "totalProbed" to hostIps.size,
                "hostsFound" to null,
                "cancelled" to true,
              ),
            )
            promise.resolve(false)
          } catch (error: Exception) {
            promise.reject("TCP_SCAN_FAILED", error.message, error)
          }
        }
      }
    }

    AsyncFunction("stopTcpScan") { promise: Promise ->
      tcpScanJob?.cancel()
      promise.resolve(true)
    }

    AsyncFunction("startServiceDiscovery") { timeoutMs: Int, promise: Promise ->
      val existing = serviceJob
      if (existing != null && existing.isActive) {
        promise.reject(ERR_SCAN_IN_PROGRESS, "A service discovery is already running", null)
      } else {
        val context = resolvedContext()
        if (context == null) {
          promise.reject(ERR_NO_CONTEXT, "React context unavailable", null)
        } else {
          serviceJob = moduleScope.launch {
            try {
              val mdnsDeferred = async(Dispatchers.IO) {
                MdnsProbe(context) { type ->
                  postEvent(
                    EVENT_SERVICE_DISCOVERED,
                    mapOf<String, Any?>(
                      "kind" to "mdns",
                      "serviceName" to type.serviceName,
                    ),
                  )
                }.collectServiceTypes(timeoutMs.toLong())
              }
              val ssdpDeferred = async(Dispatchers.IO) {
                SsdpProbe.discover(context, windowMs = timeoutMs.toLong()) { service ->
                  postEvent(
                    EVENT_SERVICE_DISCOVERED,
                    mapOf<String, Any?>(
                      "kind" to "ssdp",
                      "location" to service.location,
                      "server" to service.server,
                      "usn" to service.usn,
                      "host" to service.host,
                    ),
                  )
                }
              }
              val mdnsCount = mdnsDeferred.await()
              val ssdpCount = ssdpDeferred.await()
              postEvent(
                EVENT_SERVICE_COMPLETE,
                mapOf(
                  "mdnsCount" to mdnsCount,
                  "ssdpCount" to ssdpCount,
                  "cancelled" to false,
                ),
              )
              promise.resolve(true)
            } catch (error: CancellationException) {
              postEvent(
                EVENT_SERVICE_COMPLETE,
                mapOf(
                  "mdnsCount" to null,
                  "ssdpCount" to null,
                  "cancelled" to true,
                ),
              )
              promise.resolve(false)
            } catch (error: Exception) {
              promise.reject("SERVICE_SCAN_FAILED", error.message, error)
            }
          }
        }
      }
    }

    AsyncFunction("stopServiceDiscovery") { promise: Promise ->
      serviceJob?.cancel()
      promise.resolve(true)
    }

    /**
     * SPEC §5: one TCP handshake measurement. The RTT is valid for BOTH an
     * `open` connect and a `refused` reply (TCP RST carrier, AGENTS.md #2);
     * timeouts/unreachable carry null so PingEngine counts them as loss.
     */
    AsyncFunction("measureTcpHandshake") { ip: String, port: Int, timeoutMs: Int, promise: Promise ->
      if (port !in 1..65535) {
        promise.reject(ERR_INVALID_PARAMS, "port must be in 1..65535", null)
      } else if (timeoutMs !in 1..10_000) {
        promise.reject(ERR_INVALID_PARAMS, "timeoutMs must be in 1..10000", null)
      } else {
        moduleScope.launch {
          try {
            val measurement = withContext(Dispatchers.IO) {
              HandshakeProbe.measure(ip.trim(), port, timeoutMs, PlatformNetwork.socketFactoryFor(resolvedContext(), ip.trim()))
            }
            promise.resolve(
              mapOf(
                "outcome" to measurement.outcome.name.lowercase(),
                "rttMs" to measurement.rttMs,
              ),
            )
          } catch (error: IllegalArgumentException) {
            promise.reject(ERR_INVALID_PARAMS, "invalid target address: $ip", error)
          } catch (error: Exception) {
            promise.reject("HANDSHAKE_FAILED", error.message, error)
          }
        }
      }
    }

    /** SPEC §5: native resolver bridge (Android InetAddress), IPv4-first. */
    AsyncFunction("resolveHostname") { hostname: String, promise: Promise ->
      val trimmed = hostname.trim()
      if (trimmed.isEmpty() || trimmed.length > 253) {
        promise.reject(ERR_INVALID_HOSTNAME, "hostname must be 1..253 characters", null)
      } else {
        moduleScope.launch {
          try {
            val measurement = withContext(Dispatchers.IO) {
              HostnameResolver.resolve(trimmed)
            }
            promise.resolve(
              mapOf(
                "hostname" to measurement.hostname,
                "addresses" to measurement.addresses,
                "durationMs" to measurement.durationMs,
                "success" to measurement.success,
              ),
            )
          } catch (error: Exception) {
            promise.reject("RESOLVE_FAILED", error.message, error)
          }
        }
      }
    }

    OnDestroy {
      moduleScope.cancel()
      tcpScanJob = null
      serviceJob = null
    }
  }

  /** Deliver events on the main thread (native callbacks originate on IO). */
  private suspend fun postEvent(name: String, payload: Map<String, Any?>) =
    withContext(Dispatchers.Main) {
      sendEvent(name, payload)
    }

  private fun resolvedContext(): Context? = appContext.reactContext
}
