package expo.modules.netlenscore

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import java.net.Inet4Address
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** mDNS meta-query payload (mirrors ServiceEvent, kind = "mdns"). */
data class MdnsServicePayload(val serviceName: String?)

/** One resolved mDNS instance (mirrors ServiceEvent, kind = "mdns-instance"). */
data class MdnsInstancePayload(val instanceName: String, val serviceType: String, val host: String)

/**
 * mDNS/DNS-SD via NsdManager. Browsing "_services._dns-sd._udp.local." (the meta-query) yields the set of
 * service TYPES present on the LAN (e.g. "_http._tcp"); each is pushed to [onDiscovered] in real time.
 * Each type is then browsed for its INSTANCES (e.g. "Living Room TV"), which are resolved to an IPv4 host
 * one at a time and pushed to [onInstance].
 *
 * Uses NSD's own service discovery path (binder callback thread-safe Channel bridge). The MulticastLock is
 * managed by the module wrapper per AGENTS.md rule 4.
 */
class MdnsProbe(
  private val context: Context,
  private val onDiscovered: suspend (MdnsServicePayload) -> Unit,
  private val onInstance: suspend (MdnsInstancePayload) -> Unit,
) {
  suspend fun collectServiceTypes(windowMs: Long): Int = coroutineScope {
    val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val types = Channel<NsdServiceInfo>(Channel.UNLIMITED)
    val instances = Channel<Pair<String, NsdServiceInfo>>(Channel.UNLIMITED)
    val seenInstances = ConcurrentHashMap.newKeySet<String>()
    val browsers = mutableListOf<NsdManager.DiscoveryListener>()
    val browsedTypes = mutableSetOf<String>() // guarded by `browsers`
    var browsing = true // guarded by `browsers`
    var failed = false

    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {}
      override fun onDiscoveryStopped(serviceType: String) {}
      override fun onServiceLost(serviceInfo: NsdServiceInfo) {}

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        types.trySend(serviceInfo)
      }

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        failed = true
        types.close()
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
    }

    fun browseInstances(type: String) {
      val browser = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}

        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
          if (seenInstances.add("$type|${serviceInfo.serviceName}")) instances.trySend(type to serviceInfo)
        }
      }
      synchronized(browsers) {
        if (!browsing || !browsedTypes.add(type)) return
        runCatching { nsdManager.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, browser) }
          .onSuccess { browsers.add(browser) }
      }
    }

    var count = 0
    val consumer = launch {
      for (info in types) {
        count += 1
        onDiscovered(MdnsServicePayload(serviceName = info.serviceName))
        browsableType(info.serviceName, info.serviceType)?.let(::browseInstances)
      }
    }

    // NsdManager before API 34 rejects a second resolve while one is active, so one consumer resolves in turn.
    val resolver = launch {
      var attempts = 0
      for ((type, info) in instances) {
        if (attempts++ >= MAX_RESOLVES) break
        val host = resolve(nsdManager, info)?.let(::ipv4Host) ?: continue
        onInstance(MdnsInstancePayload(instanceName = info.serviceName, serviceType = type, host = host))
      }
    }

    nsdManager.discoverServices("_services._dns-sd._udp.local.", NsdManager.PROTOCOL_DNS_SD, listener)
    try {
      if (!failed) delay(windowMs)
    } finally {
      val toStop = synchronized(browsers) {
        browsing = false
        browsers.toList()
      }
      (toStop + listener).forEach { runCatching { nsdManager.stopServiceDiscovery(it) } }
      types.close()
      instances.close()
      consumer.join()
      resolver.cancelAndJoin()
    }
    count
  }

  // resolveService is deprecated from API 34 (registerServiceInfoCallback replaces it) but works on every
  // API we support, and one code path is all we can test.
  @Suppress("DEPRECATION")
  private suspend fun resolve(nsdManager: NsdManager, info: NsdServiceInfo): NsdServiceInfo? {
    val result = CompletableDeferred<NsdServiceInfo?>()
    val started = runCatching {
      nsdManager.resolveService(
        info,
        object : NsdManager.ResolveListener {
          override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
            result.complete(null)
          }

          override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
            result.complete(serviceInfo)
          }
        },
      )
    }
    return if (started.isSuccess) withTimeoutOrNull(RESOLVE_TIMEOUT_MS) { result.await() } else null
  }

  // From API 34 `host` is only the first address, which can be IPv6 while an IPv4 exists; hostAddresses has all.
  @Suppress("DEPRECATION")
  private fun ipv4Host(info: NsdServiceInfo): String? {
    val addresses =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) info.hostAddresses
      else listOfNotNull(info.host)
    return addresses.firstNotNullOfOrNull { (it as? Inet4Address)?.hostAddress }
  }

  companion object {
    const val MAX_RESOLVES = 32
    const val RESOLVE_TIMEOUT_MS = 1500L

    /**
     * The browsable type for a meta-query result: its serviceName ("_googlecast") and serviceType
     * ("_tcp.local.") joined and stripped of ".local." ("_googlecast._tcp"); null for anything else.
     */
    internal fun browsableType(serviceName: String?, serviceType: String?): String? {
      val protocol = serviceType?.trim()?.trim('.')?.removeSuffix(".local") ?: return null
      val type = "${serviceName?.trim()?.trim('.')}.$protocol"
      return type.takeIf { TYPE_PATTERN.matches(it) }
    }

    private val TYPE_PATTERN = Regex("_[^._][^.]*\\._(tcp|udp)")
  }
}
