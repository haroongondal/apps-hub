package expo.modules.storeinstaller

import android.app.ActivityManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

internal const val EXTRA_PACKAGE = "expo.modules.storeinstaller.PACKAGE"
internal const val EXTRA_NAME = "expo.modules.storeinstaller.NAME"

object Installer {
  // Kept until an install succeeds, so a retry after Play Protect aborts does not download it again.
  fun download(
    context: Context, url: String, packageName: String, sha256: String, certSha256: String,
    onProgress: (done: Long, total: Long) -> Unit,
  ): File {
    val file = File(cacheDir(context), "${sha256.lowercase()}.apk")
    if (!file.exists()) fetch(url, file, onProgress)
    val archive = Packages.archive(context, file.path)
    ApkVerifier.mismatch(
      packageName, sha256, certSha256,
      archive?.packageName, fileSha256(file), archive?.let(Packages::certs).orEmpty(),
    )?.let {
      file.delete()
      throw SecurityException(it)
    }
    return file
  }

  fun clearDownloads(context: Context) = cacheDir(context).deleteRecursively()

  fun isForeground(): Boolean =
    ActivityManager.RunningAppProcessInfo().also(ActivityManager::getMyMemoryState).importance ==
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND

  private fun cacheDir(context: Context) = File(context.cacheDir, "apks")

  private fun fetch(url: String, file: File, onProgress: (Long, Long) -> Unit) {
    val part = File(file.path + ".part").apply { parentFile?.mkdirs() }
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 60_000
    try {
      if (conn.responseCode != 200) throw IOException("Download failed: the server answered HTTP ${conn.responseCode}.")
      val total = conn.contentLengthLong
      conn.inputStream.use { input ->
        part.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          var done = 0L
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            done += n
            onProgress(done, total)
          }
        }
      }
      if (!part.renameTo(file)) throw IOException("Could not save the download.")
    } finally {
      conn.disconnect()
      part.delete()
    }
  }

  private fun fileSha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        digest.update(buf, 0, n)
      }
    }
    return ApkVerifier.hex(digest.digest())
  }

  fun commit(context: Context, file: File, packageName: String, name: String): Int {
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(packageName)
      setSize(file.length())
      // HyperOS (PKMSImpl.assertCallerAndPackage) aborts silent installs from non-allowlisted installers with "Permission denied".
      if (Build.VERSION.SDK_INT >= 31) {
        setRequireUserAction(
          if (Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true)) PackageInstaller.SessionParams.USER_ACTION_REQUIRED
          else PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED,
        )
      }
    }
    val id = installer.createSession(params)
    try {
      installer.openSession(id).use { session ->
        file.inputStream().use { input ->
          session.openWrite("base.apk", 0, file.length()).use { out ->
            input.copyTo(out)
            session.fsync(out)
          }
        }
        val intent = Intent(context, InstallResultReceiver::class.java)
          .putExtra(EXTRA_PACKAGE, packageName)
          .putExtra(EXTRA_NAME, name)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        session.commit(PendingIntent.getBroadcast(context, id, intent, flags).intentSender)
      }
      return id
    } catch (e: Exception) {
      installer.abandonSession(id)
      throw e
    }
  }
}
