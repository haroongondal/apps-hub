package expo.modules.storeinstaller

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.DigestInputStream
import java.security.MessageDigest

internal const val EXTRA_PACKAGE = "expo.modules.storeinstaller.PACKAGE"

object Installer {
  /** Downloads to app-private storage, verifies hash/package/signer, then commits a PackageInstaller session. */
  fun install(context: Context, url: String, packageName: String, sha256: String, certSha256: String): Int {
    val file = File(context.cacheDir, "apks/$packageName.apk").apply { parentFile?.mkdirs() }
    try {
      val digest = MessageDigest.getInstance("SHA-256")
      val conn = URL(url).openConnection() as HttpURLConnection
      conn.connectTimeout = 15_000
      conn.readTimeout = 60_000
      try {
        if (conn.responseCode != 200) throw IOException("download failed: HTTP ${conn.responseCode}")
        DigestInputStream(conn.inputStream, digest).use { input -> file.outputStream().use { input.copyTo(it) } }
      } finally {
        conn.disconnect()
      }
      val archive = Packages.archive(context, file.path)
      ApkVerifier.mismatch(
        packageName, sha256, certSha256,
        archive?.packageName, ApkVerifier.hex(digest.digest()), archive?.let(Packages::certs).orEmpty(),
      )?.let { throw SecurityException(it) }
      return commit(context, file, packageName)
    } finally {
      file.delete()
    }
  }

  private fun commit(context: Context, file: File, packageName: String): Int {
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(packageName)
      setSize(file.length())
      if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
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
        val intent = Intent(context, InstallResultReceiver::class.java).putExtra(EXTRA_PACKAGE, packageName)
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
