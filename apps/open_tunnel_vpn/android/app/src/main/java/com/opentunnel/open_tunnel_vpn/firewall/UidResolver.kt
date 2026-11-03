package com.opentunnel.open_tunnel_vpn.firewall

import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Build
import expo.modules.opentunnelnative.firewall.FirewallDecision
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * Attributes a flow to the app that owns it. A UID it cannot resolve stays -1 and is labelled
 * UNKNOWN_APP_LABEL; the engine allows such flows (ruling R9).
 */
object UidResolver {

  /** The owning UID of a flow, or -1 when the system will not say or the device is below Android 10. */
  fun ownerUid(cm: ConnectivityManager, protocol: Int, src: InetSocketAddress, dst: InetSocketAddress): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return -1
    return runCatching { cm.getConnectionOwnerUid(protocol, src, dst) }.getOrDefault(-1)
  }

  fun packageFor(pm: PackageManager, uid: Int): String =
    packageLabel(uid, if (uid < 0) null else pm.getPackagesForUid(uid))

  /** A shared system UID lists several packages; the first stands for all of them. */
  fun packageLabel(uid: Int, packages: Array<String>?): String =
    if (uid < 0) FirewallDecision.UNKNOWN_APP_LABEL else packages?.firstOrNull() ?: "uid:$uid"

  /** Parses firestack's `host:port` and `[v6]:port` strings; null when the port or host is unusable. */
  fun socketAddress(hostPort: String?): InetSocketAddress? {
    val split = hostPort?.lastIndexOf(':') ?: return null
    if (split < 0) return null
    val port = hostPort.substring(split + 1).toIntOrNull() ?: return null
    val host = hostPort.substring(0, split).trim('[', ']')
    return runCatching { InetSocketAddress(InetAddress.getByName(host), port) }.getOrNull()
  }
}
