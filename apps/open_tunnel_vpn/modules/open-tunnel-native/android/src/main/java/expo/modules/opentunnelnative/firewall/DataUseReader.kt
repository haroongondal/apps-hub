package expo.modules.opentunnelnative.firewall

import android.app.AppOpsManager
import android.app.usage.NetworkStats
import android.app.usage.NetworkStatsManager
import android.content.Context
import android.net.ConnectivityManager
import android.os.Process

data class DataUseRow(val uid: Int, val wifiBytes: Long, val cellBytes: Long)

/** Per-app data use from `NetworkStatsManager`. It needs the Usage access grant and no VPN. */
object DataUseReader {

  /** Merges (uid, wifiBytes, cellBytes) triples by UID and drops the UIDs that used nothing. */
  fun rows(stats: List<Triple<Int, Long, Long>>): List<DataUseRow> =
    stats.groupBy { it.first }
      .map { (uid, parts) -> DataUseRow(uid, parts.sumOf { it.second }, parts.sumOf { it.third }) }
      .filter { it.wifiBytes != 0L || it.cellBytes != 0L }

  fun hasUsageAccess(context: Context): Boolean {
    val ops = context.getSystemService(AppOpsManager::class.java)
    return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) ==
      AppOpsManager.MODE_ALLOWED
  }

  /** (uid, wifiBytes, cellBytes) per summary bucket; the caller checks [hasUsageAccess] first. */
  @Suppress("DEPRECATION") // querySummary still takes the legacy TYPE_WIFI and TYPE_MOBILE constants.
  fun query(context: Context, startMs: Long, endMs: Long): List<Triple<Int, Long, Long>> {
    val manager = context.getSystemService(NetworkStatsManager::class.java)
    return summary(manager, ConnectivityManager.TYPE_WIFI, startMs, endMs) { uid, bytes -> Triple(uid, bytes, 0L) } +
      summary(manager, ConnectivityManager.TYPE_MOBILE, startMs, endMs) { uid, bytes -> Triple(uid, 0L, bytes) }
  }

  private fun summary(
    manager: NetworkStatsManager,
    networkType: Int,
    startMs: Long,
    endMs: Long,
    row: (Int, Long) -> Triple<Int, Long, Long>,
  ): List<Triple<Int, Long, Long>> {
    val stats = manager.querySummary(networkType, null, startMs, endMs)
    try {
      val bucket = NetworkStats.Bucket()
      return buildList {
        while (stats.hasNextBucket()) {
          stats.getNextBucket(bucket)
          // Negative UIDs are tethering and removed apps: they belong to no app on the list.
          if (bucket.uid >= 0) add(row(bucket.uid, bucket.rxBytes + bucket.txBytes))
        }
      }
    } finally {
      stats.close()
    }
  }
}
