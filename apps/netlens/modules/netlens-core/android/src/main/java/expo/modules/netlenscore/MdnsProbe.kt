package expo.modules.netlenscore

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** mDNS meta-query payload (mirrors ServiceEvent, kind = "mdns"). */
data class MdnsServicePayload(val serviceName: String?)

/**
 * mDNS/DNS-SD meta-query via NsdManager: browsing "_services._dns-sd._udp
 * .local." yields the set of service TYPES present on the LAN (e.g.
 * "_http._tcp"). Each type is pushed to [onDiscovered] in real time.
 *
 * Uses NSD's own service discovery path (binder callback thread-safe
 * Channel bridge). The MulticastLock is managed by the module wrapper per
 * AGENTS.md rule 4.
 */
class MdnsProbe(
  private val context: Context,
  private val onDiscovered: suspend (MdnsServicePayload) -> Unit,
) {
  suspend fun collectServiceTypes(windowMs: Long): Int = coroutineScope {
    val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val types = Channel<String>(Channel.UNLIMITED)
    var failed = false

    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {}
      override fun onDiscoveryStopped(serviceType: String) {}
      override fun onServiceLost(serviceInfo: NsdServiceInfo) {}

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        types.trySend(serviceInfo.serviceName)
      }

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        failed = true
        types.close()
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
    }

    var count = 0
    val consumer = launch {
      for (typeName in types) {
        count += 1
        onDiscovered(MdnsServicePayload(serviceName = typeName))
      }
    }

    nsdManager.discoverServices("_services._dns-sd._udp.local.", NsdManager.PROTOCOL_DNS_SD, listener)
    try {
      if (!failed) delay(windowMs)
    } finally {
      runCatching { nsdManager.stopServiceDiscovery(listener) }
      types.close()
      consumer.join()
    }
    count
  }
}
