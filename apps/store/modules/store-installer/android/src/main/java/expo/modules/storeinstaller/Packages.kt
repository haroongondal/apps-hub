package expo.modules.storeinstaller

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat

@Suppress("DEPRECATION")
object Packages {
  private val certFlags =
    if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

  fun installed(context: Context, packageName: String): Map<String, Any?>? {
    val pm = context.packageManager
    val info = try {
      pm.getPackageInfo(packageName, certFlags)
    } catch (e: PackageManager.NameNotFoundException) {
      return null
    }
    val installer =
      if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(packageName).installingPackageName
      else pm.getInstallerPackageName(packageName)
    return mapOf(
      "versionCode" to PackageInfoCompat.getLongVersionCode(info).toDouble(),
      "versionName" to info.versionName,
      "installer" to installer,
      "signingCertSha256" to certs(info),
    )
  }

  fun installedVersionCode(context: Context, packageName: String): Long? = try {
    PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(packageName, 0))
  } catch (e: PackageManager.NameNotFoundException) {
    null
  }

  fun archive(context: Context, path: String): PackageInfo? = context.packageManager.getPackageArchiveInfo(path, certFlags)

  fun certs(info: PackageInfo): List<String> {
    val signers = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    return signers.orEmpty().map { ApkVerifier.sha256(it.toByteArray()) }
  }
}
