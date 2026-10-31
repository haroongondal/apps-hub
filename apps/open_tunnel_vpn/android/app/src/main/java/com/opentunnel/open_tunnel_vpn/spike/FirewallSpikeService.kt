package com.opentunnel.open_tunnel_vpn.spike

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.IpPrefix
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.util.Log
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
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress

/** THROWAWAY firewall spike (branch firewall-spike, never merged). */
class FirewallSpikeService : VpnService() {

  private var tunnel: Tunnel? = null
  private var tun: ParcelFileDescriptor? = null
  private var nextConnId = 0L
  private var dotBlockedLogged = false
  private var protectLogged = 0

  override fun onCreate() {
    super.onCreate()
    init(filesDir)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start()
      ACTION_STOP -> stop()
    }
    return START_NOT_STICKY
  }

  override fun onRevoke() {
    append("revoked by the system: another VPN took the slot")
    stop()
  }

  override fun onDestroy() {
    release()
    super.onDestroy()
  }

  private fun start() {
    startForegroundNow()
    if (tunnel != null) return
    try {
      val systemDns = underlyingDns()
      val tunFd = buildTun().also { tun = it }
      val connected = Intra.connect(tunFd.fd.toLong(), MTU, MTU, TUN_ADDRESSES, FAKE_DNS, null, SpikeBridge())
      tunnel = connected
      // Without this the System resolver reads the VPN's own fake DNS and every lookup loops back into the tun.
      if (systemDns.isNotEmpty()) Intra.setSystemDNS(connected, systemDns)
      append("started: tun up, firestack connected (sdk ${Build.VERSION.SDK_INT}), system dns [$systemDns]")
    } catch (failure: Exception) {
      append("start failed: ${failure.javaClass.simpleName}: ${failure.message}")
      stop()
    }
  }

  private fun buildTun(): ParcelFileDescriptor {
    val builder = Builder().setSession("Firewall spike").setMtu(MTU.toInt())
    builder.addAddress("100.127.222.1", 24).addAddress("fd66:f83a:c650::1", 120)
    builder.addDnsServer("100.127.222.3").addDnsServer("fd66:f83a:c650::3")
    builder.addRoute("0.0.0.0", 0).addRoute("::", 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      for ((address, length) in LAN_EXCLUSIONS) {
        builder.excludeRoute(IpPrefix(InetAddress.getByName(address), length))
      }
    } else {
      append("api < 33: LAN ranges stay inside the tun")
    }
    try {
      builder.addDisallowedApplication(HOMENET_PACKAGE)
    } catch (_: android.content.pm.PackageManager.NameNotFoundException) {
      append("$HOMENET_PACKAGE not installed: nothing to exclude")
    }
    return builder.establish() ?: throw IllegalStateException("establish() returned null")
  }

  private fun startForegroundNow() {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Firewall spike", NotificationManager.IMPORTANCE_LOW),
    )
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Firewall spike")
      .setContentText("Throwaway test build: all traffic runs through firestack")
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stop() {
    release()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun release() {
    if (tunnel != null || tun != null) append("stopped")
    runCatching { tunnel?.disconnect() }
    tunnel = null
    runCatching { tun?.close() }
    tun = null
  }

  private fun underlyingDns(): String {
    val manager = getSystemService(ConnectivityManager::class.java)
    val network = manager.activeNetwork ?: return ""
    val servers = manager.getLinkProperties(network)?.dnsServers ?: return ""
    return servers.mapNotNull { it.hostAddress }.joinToString(",")
  }

  private fun ownerUid(protocol: Int, src: String?, dst: String?): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return -1
    val local = socketAddress(src) ?: return -1
    val remote = socketAddress(dst) ?: return -1
    val manager = getSystemService(ConnectivityManager::class.java)
    return runCatching { manager.getConnectionOwnerUid(protocol, local, remote) }.getOrDefault(-1)
  }

  private fun socketAddress(hostPort: String?): InetSocketAddress? {
    val split = hostPort?.lastIndexOf(':') ?: return null
    if (split < 0) return null
    val port = hostPort.substring(split + 1).toIntOrNull() ?: return null
    val host = hostPort.substring(0, split).trim('[', ']')
    return runCatching { InetSocketAddress(InetAddress.getByName(host), port) }.getOrNull()
  }

  private fun packageFor(uid: Int): String =
    if (uid < 0) "unknown" else packageManager.getPackagesForUid(uid)?.firstOrNull() ?: "uid:$uid"

  private inner class SpikeBridge : Bridge {
    override fun bind4(who: String?, addrPort: String?, fd: Long) = keepOutOfTun("bind4", who, addrPort, fd)
    override fun bind6(who: String?, addrPort: String?, fd: Long) = keepOutOfTun("bind6", who, addrPort, fd)
    override fun protect(who: String?, fd: Long) = keepOutOfTun("protect", who, "", fd)

    private fun keepOutOfTun(hook: String, who: String?, addrPort: String?, fd: Long) {
      val ok = this@FirewallSpikeService.protect(fd.toInt())
      if (!ok || protectLogged++ < PROTECT_LOG_LIMIT) append("$hook who=$who addr=$addrPort fd=$fd protected=$ok")
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
      val pkg = packageFor(owner)
      val target = socketAddress(dst)
      val toVpnDns = target != null && VPN_DNS.contains(target.address)
      val verdict = when {
        // The tun does not serve DNS-over-TLS: rejecting it makes Android fall back to plain DNS on port 53.
        toVpnDns && target?.port == DOT_PORT -> Backend.Block
        toVpnDns && target?.port == DNS_PORT -> Backend.Base
        pkg == BLOCKED_PACKAGE -> Backend.Block
        else -> Backend.Exit
      }
      if (!toVpnDns) append("flow $owner $pkg proto=$protocol $src -> $dst domains=$domains $verdict")
      else if (verdict == Backend.Block && !dotBlockedLogged) {
        dotBlockedLogged = true
        append("private dns: blocked DNS-over-TLS to the tun DNS from uid $owner $pkg (logged once)")
      }
      return Mark().also {
        it.setPIDCSV(verdict)
        it.setCID("c${nextConnId++}")
        it.setUID(owner.toString())
      }
    }

    override fun inflow(protocol: Int, uid: Int, src: String?, dst: String?): Mark {
      val owner = if (uid >= 0) uid else ownerUid(protocol, src, dst)
      return Mark().also {
        it.setPIDCSV(Backend.Ingress)
        it.setCID("c${nextConnId++}")
        it.setUID(owner.toString())
      }
    }

    override fun flowing(mark: Mark?) {}

    override fun postflow(summary: FlowSummary?) {
      if (summary != null) append("done ${summary.getUID()} ${summary.getProto()} rx=${summary.getRx()} tx=${summary.getTx()}")
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

    override fun onResponse(summary: DNSSummary?) {
      if (summary != null) append("dns ${summary.getQName()} status=${summary.getStatus()} via ${summary.getServer()}")
    }

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

  companion object {
    const val ACTION_START = "com.opentunnel.open_tunnel_vpn.spike.START"
    const val ACTION_STOP = "com.opentunnel.open_tunnel_vpn.spike.STOP"

    private const val TAG = "FirewallSpike"
    private const val CHANNEL_ID = "firewall-spike"
    private const val NOTIFICATION_ID = 7001
    private const val MTU = 1500L
    private const val BLOCKED_PACKAGE = "com.android.chrome"
    private const val HOMENET_PACKAGE = "app.netlens"
    private const val TUN_ADDRESSES = "100.127.222.1/24,fd66:f83a:c650::1/120"
    private const val FAKE_DNS = "100.127.222.3:53,[fd66:f83a:c650::3]:53"
    private const val MAX_LINES = 200
    private const val MAX_BYTES = 262144L
    private val STATE_MARKERS = listOf("started:", "stopped", "revoked", "start failed")
    private const val PROTECT_LOG_LIMIT = 8
    private const val DNS_PORT = 53
    private const val DOT_PORT = 853
    private val VPN_DNS = listOf("100.127.222.3", "fd66:f83a:c650::3").map { InetAddress.getByName(it) }

    private val LAN_EXCLUSIONS = listOf(
      "10.0.0.0" to 8, "172.16.0.0" to 12, "192.168.0.0" to 16, "169.254.0.0" to 16,
      "224.0.0.0" to 4, "fe80::" to 10, "ff00::" to 8,
    )

    private var logFile: File? = null

    fun init(dir: File) {
      logFile = File(dir, "spike.log")
    }

    @Synchronized
    fun append(line: String) {
      Log.i(TAG, line)
      val file = logFile ?: return
      runCatching {
        file.appendText(line + "\n")
        if (file.length() > MAX_BYTES) file.writeText(snapshot() + "\n")
      }
    }

    @Synchronized
    fun snapshot(): String =
      runCatching { logFile?.readLines()?.takeLast(MAX_LINES)?.joinToString("\n") }.getOrNull().orEmpty()

    fun isRunning(): Boolean =
      snapshot().lines().lastOrNull { STATE_MARKERS.any { marker -> it.startsWith(marker) } }?.startsWith("started:") == true
  }
}
