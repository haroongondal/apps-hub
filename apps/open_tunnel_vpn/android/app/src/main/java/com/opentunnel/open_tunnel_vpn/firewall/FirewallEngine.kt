package com.opentunnel.open_tunnel_vpn.firewall

import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.system.OsConstants
import android.util.Log
import androidx.annotation.RequiresApi
import com.celzero.firestack.backend.Backend
import com.celzero.firestack.backend.DNSOpts
import com.celzero.firestack.backend.DNSSummary
import com.celzero.firestack.backend.DomainOpts
import com.celzero.firestack.backend.ServerSummary
import com.celzero.firestack.backend.Tab
import com.celzero.firestack.intra.Bridge
import com.celzero.firestack.intra.FlowSummary
import com.celzero.firestack.intra.Intra
import com.celzero.firestack.intra.Mark
import com.celzero.firestack.intra.PreMark
import com.celzero.firestack.intra.Tunnel
import expo.modules.opentunnelnative.firewall.FirewallDecision
import expo.modules.opentunnelnative.firewall.FirewallRule
import expo.modules.opentunnelnative.firewall.FirewallStore
import expo.modules.opentunnelnative.firewall.LogEntry
import expo.modules.opentunnelnative.firewall.Verdict
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

@RequiresApi(Build.VERSION_CODES.Q)
class FirewallEngine(
  private val service: VpnService,
  private val store: FirewallStore,
  private val readSystemDns: () -> String,
) {

  private val connectivity = service.getSystemService(ConnectivityManager::class.java)

  @Volatile private var tunnel: Tunnel? = null
  @Volatile private var writer: ScheduledExecutorService? = null
  @Volatile private var rules: Map<Int, FirewallRule> = emptyMap()
  @Volatile private var onCellular = false
  @Volatile private var dnsPortNoticeLogged = false
  @Volatile private var upstreamDns = ""
  private var lastRetentionMs = 0L

  private val nextConnId = AtomicLong()
  // Guarded by itself; insertion order picks the eldest entry to evict at the cap.
  private val openAllowedFlows = LinkedHashMap<String, LogEntry>()
  private val flushQueued = AtomicBoolean(false)
  private val unmatchedPostflows = AtomicLong()
  private val untrackedFlows = AtomicLong()
  private val evictedFlows = AtomicLong()
  private val labels = ConcurrentHashMap<Int, String>()
  private val pending = LinkedBlockingQueue<LogEntry>()

  private val networkWatcher = object : ConnectivityManager.NetworkCallback() {
    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
      // The tun's capabilities follow the network under it, so a change here can mean other DNS servers.
      refreshDns()
      val cellular = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
      if (cellular == onCellular) return
      onCellular = cellular
      closeBlocked(null)
    }
  }

  // This process's default network is the firewall's own tun, so upstream DNS follows the non-VPN networks.
  private val dnsWatcher = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = refreshDns()
    override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) = refreshDns()
    override fun onLost(network: Network) = refreshDns()
  }

  fun start(tunFd: ParcelFileDescriptor, systemDns: String): Boolean {
    if (tunnel != null) return true
    return try {
      rules = store.rules()
      labels.clear()
      unmatchedPostflows.set(0)
      untrackedFlows.set(0)
      evictedFlows.set(0)
      onCellular = connectivity.activeNetwork
        ?.let { connectivity.getNetworkCapabilities(it) }
        ?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
      connectivity.registerDefaultNetworkCallback(networkWatcher)
      writer = Executors.newSingleThreadScheduledExecutor().also {
        it.scheduleWithFixedDelay(::flush, FLUSH_INTERVAL_MS, FLUSH_INTERVAL_MS, TimeUnit.MILLISECONDS)
      }
      val connected = Intra.connect(
        tunFd.fd.toLong(),
        FirewallNetworks.MTU.toLong(),
        FirewallNetworks.MTU.toLong(),
        TUN_ADDRESSES,
        FirewallNetworks.FAKE_DNS,
        null,
        FlowBridge(),
      )
      tunnel = connected
      if (systemDns.isNotEmpty()) Intra.setSystemDNS(connected, systemDns)
      upstreamDns = systemDns
      connectivity.registerNetworkCallback(
        NetworkRequest.Builder()
          .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
          .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .build(),
        dnsWatcher,
      )
      Log.i(TAG, "firestack connected with ${rules.size} rules, system dns [$systemDns]")
      true
    } catch (failure: Exception) {
      startFailed(failure)
    } catch (failure: LinkageError) {
      startFailed(failure)
    }
  }

  private fun startFailed(failure: Throwable): Boolean {
    Log.e(TAG, "firestack did not start: ${failure.javaClass.simpleName}: ${failure.message}")
    stop()
    return false
  }

  fun stop() {
    val wasRunning = tunnel != null
    runCatching { connectivity.unregisterNetworkCallback(networkWatcher) }
    runCatching { connectivity.unregisterNetworkCallback(dnsWatcher) }
    runCatching { tunnel?.disconnect() }
    tunnel = null
    // Flows still open at stop get an entry with no byte counts rather than vanishing from the log.
    val leftOpen = synchronized(openAllowedFlows) { openAllowedFlows.values.toList().also { openAllowedFlows.clear() } }
    leftOpen.forEach(pending::add)
    if (wasRunning) {
      Log.i(
        TAG,
        "postflow unmatched: ${unmatchedPostflows.get()}, flows not tracked: ${untrackedFlows.get()}, " +
          "evicted: ${evictedFlows.get()}",
      )
    }
    writer?.shutdown()
    writer = null
    flush()
  }

  fun reload() {
    val before = rules
    val after = store.rules()
    rules = after
    val changed = (before.keys + after.keys).filter { ruleOf(before, it) != ruleOf(after, it) }.toSet()
    closeBlocked(changed)
    Log.i(TAG, "reloaded ${after.size} rules, ${changed.size} changed")
  }

  /** A new Wi-Fi, mobile data, or new DNS on the same network: the tun stays up, only the upstream changes. */
  private fun refreshDns() {
    val running = tunnel ?: return
    try {
      val servers = readSystemDns()
      if (servers.isEmpty() || servers == upstreamDns) return
      Intra.setSystemDNS(running, servers)
      upstreamDns = servers
      Log.i(TAG, "system dns now [$servers]")
    } catch (failure: Exception) {
      Log.e(TAG, "could not update the system dns: ${failure.message}")
    }
  }

  private fun closeBlocked(uids: Set<Int>?) {
    val running = tunnel ?: return
    val ids = synchronized(openAllowedFlows) {
      openAllowedFlows.filterValues {
        (uids == null || it.uid in uids) && FirewallDecision.shouldCloseOpen(ruleOf(rules, it.uid), onCellular)
      }.keys.toList()
    }
    // An empty list would close every flow.
    if (ids.isEmpty()) return
    running.closeConns(ids.joinToString(","))
    Log.i(TAG, "closed ${ids.size} open flows")
  }

  private fun ruleOf(all: Map<Int, FirewallRule>, uid: Int): FirewallRule = all[uid] ?: FirewallRule.ALLOW

  private fun record(entry: LogEntry) {
    pending.add(entry)
    if (pending.size < BATCH_SIZE || !flushQueued.compareAndSet(false, true)) return
    val executor = writer
    if (executor == null) {
      flushQueued.set(false)
      return
    }
    try {
      executor.execute {
        flushQueued.set(false)
        flush()
      }
    } catch (_: RejectedExecutionException) {
      flushQueued.set(false)
    }
  }

  private fun trackOpen(cid: String, entry: LogEntry) {
    val evicted = synchronized(openAllowedFlows) {
      openAllowedFlows[cid] = entry
      if (openAllowedFlows.size <= MAX_OPEN_FLOWS) {
        null
      } else {
        val eldest = openAllowedFlows.keys.first()
        openAllowedFlows.remove(eldest)
      }
    }
    if (evicted != null) {
      evictedFlows.incrementAndGet()
      record(evicted)
    }
  }

  @Synchronized
  private fun flush() {
    val batch = ArrayList<LogEntry>()
    pending.drainTo(batch)
    if (batch.isEmpty()) return
    try {
      store.appendBatch(batch)
      val now = System.currentTimeMillis()
      if (now - lastRetentionMs >= RETENTION_INTERVAL_MS) {
        lastRetentionMs = now
        store.enforceRetention(now)
      }
    } catch (failure: Exception) {
      Log.e(TAG, "could not write ${batch.size} activity entries: ${failure.message}")
    }
  }

  private fun ownerUid(protocol: Int, src: String?, dst: String?): Int {
    val local = UidResolver.socketAddress(src) ?: return -1
    val remote = UidResolver.socketAddress(dst) ?: return -1
    return UidResolver.ownerUid(connectivity, protocol, local, remote)
  }

  private fun appLabel(uid: Int): String = labels.getOrPut(uid) { UidResolver.packageFor(service.packageManager, uid) }

  private fun protoName(protocol: Int): String = when (protocol) {
    OsConstants.IPPROTO_TCP -> Intra.ProtoTypeTCP
    OsConstants.IPPROTO_UDP -> Intra.ProtoTypeUDP
    OsConstants.IPPROTO_ICMP, OsConstants.IPPROTO_ICMPV6 -> Intra.ProtoTypeICMP
    else -> protocol.toString()
  }

  private fun firstDomain(csv: String?): String? = csv?.substringBefore(',')?.trim()?.takeIf { it.isNotEmpty() }

  private fun verdictFor(uid: Int): Verdict =
    if (uid < 0) Verdict.ALLOW else FirewallDecision.verdict(ruleOf(rules, uid), onCellular)

  private inner class FlowBridge : Bridge {
    override fun bind4(who: String?, addrPort: String?, fd: Long) = keepOutOfTun(fd)
    override fun bind6(who: String?, addrPort: String?, fd: Long) = keepOutOfTun(fd)
    override fun protect(who: String?, fd: Long) = keepOutOfTun(fd)

    private fun keepOutOfTun(fd: Long) {
      if (!service.protect(fd.toInt())) Log.w(TAG, "could not protect socket $fd")
    }

    override fun preflow(protocol: Int, uid: Int, src: String?, dst: String?): PreMark {
      val owner = if (uid >= 0) uid else ownerUid(protocol, src, dst)
      return PreMark().also {
        it.setUID(owner.toString())
        it.setIsUidSelf(owner == Process.myUid())
      }
    }

    override fun flow(
      protocol: Int,
      uid: Int,
      src: String?,
      dst: String?,
      realIps: String?,
      domains: String?,
      probableDomains: String?,
      blocklists: String?,
      isAlg: Boolean,
    ): Mark {
      val owner = if (uid >= 0) uid else ownerUid(protocol, src, dst)
      val target = UidResolver.socketAddress(dst)
      val cid = "c${nextConnId.getAndIncrement()}"
      val toTunDns = target != null && TUN_DNS.contains(target.address)
      val pid = when {
        // Integration rule 1: Exit would redial the tun address and flood.
        toTunDns && target?.port == DNS_PORT -> {
          untrackedFlows.incrementAndGet()
          Backend.Base
        }
        toTunDns -> {
          untrackedFlows.incrementAndGet()
          if (!dnsPortNoticeLogged) {
            dnsPortNoticeLogged = true
            Log.i(TAG, "blocked port ${target?.port} to the tun DNS address from uid $owner (logged once)")
          }
          Backend.Block
        }
        else -> {
          val verdict = verdictFor(owner)
          val entry = LogEntry(
            timestampMs = System.currentTimeMillis(),
            uid = owner,
            pkg = appLabel(owner),
            proto = protoName(protocol),
            dst = target?.address?.hostAddress ?: dst.orEmpty(),
            dstPort = target?.port ?: 0,
            domain = firstDomain(domains) ?: firstDomain(probableDomains),
            bytesOut = 0,
            bytesIn = 0,
            verdict = verdict,
          )
          if (verdict == Verdict.BLOCK) {
            untrackedFlows.incrementAndGet()
            record(entry)
            Backend.Block
          } else {
            trackOpen(cid, entry)
            Backend.Exit
          }
        }
      }
      return Mark().also {
        it.setPIDCSV(pid)
        it.setCID(cid)
        it.setUID(owner.toString())
      }
    }

    override fun inflow(protocol: Int, uid: Int, src: String?, dst: String?): Mark {
      untrackedFlows.incrementAndGet()
      val owner = if (uid >= 0) uid else ownerUid(protocol, src, dst)
      return Mark().also {
        it.setPIDCSV(Backend.Ingress)
        it.setCID("c${nextConnId.getAndIncrement()}")
        it.setUID(owner.toString())
      }
    }

    override fun flowing(mark: Mark?) {}

    override fun postflow(summary: FlowSummary?) {
      val ended = summary ?: return
      val entry = synchronized(openAllowedFlows) { openAllowedFlows.remove(ended.getID()) }
      if (entry == null) {
        unmatchedPostflows.incrementAndGet()
        return
      }
      record(entry.copy(bytesOut = ended.getTx(), bytesIn = ended.getRx()))
    }

    override fun onQuery(origin: String?, uid: String?, fqdn: String?, qtype: Long): DNSOpts =
      DNSOpts().also {
        it.setUID(uid ?: "")
        it.setIPCSV("")
        it.setTIDCSV("${Backend.System}:${Backend.Base}")
        it.setTIDSECCSV("")
        it.setNOBLOCK(true)
      }

    override fun onPrequery(a: String?, b: String?, c: String?, d: Long): DomainOpts? = null

    override fun onUpstreamAnswer(id: String?, summary: DNSSummary?, opts: DNSOpts?, ips: String?): DNSOpts =
      opts ?: DNSOpts()

    override fun onResponse(summary: DNSSummary?) {}
    override fun onDNSAdded(id: String?) {}
    override fun onDNSRemoved(id: String?) {}
    override fun onDNSStopped() {}
    override fun onProxiesStopped() {}
    override fun onProxyAdded(id: String?, name: String?) {}
    override fun onProxyRemoved(id: String?, name: String?) {}
    override fun onProxyStopped(id: String?, name: String?) {}
    override fun onProxyUpdated(id: String?, name: String?) {}
    override fun onSvcComplete(summary: ServerSummary?) {}
    override fun svcRoute(a: String?, b: String?, c: String?, d: String?, e: String?): Tab = Tab()
  }

  private companion object {
    const val TAG = "FirewallEngine"
    const val DNS_PORT = 53
    const val BATCH_SIZE = 200
    const val MAX_OPEN_FLOWS = 4096
    const val FLUSH_INTERVAL_MS = 2_000L
    const val RETENTION_INTERVAL_MS = 60_000L
    const val TUN_ADDRESSES =
      "${FirewallNetworks.TUN_IPV4}/${FirewallNetworks.TUN_IPV4_PREFIX}," +
        "${FirewallNetworks.TUN_IPV6}/${FirewallNetworks.TUN_IPV6_PREFIX}"
    val TUN_DNS = listOf(FirewallNetworks.TUN_DNS_IPV4, FirewallNetworks.TUN_DNS_IPV6).map { InetAddress.getByName(it) }
  }
}
