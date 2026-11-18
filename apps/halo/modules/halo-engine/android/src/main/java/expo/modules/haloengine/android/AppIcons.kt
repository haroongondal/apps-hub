package expo.modules.haloengine.android

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.LruCache
import expo.modules.haloengine.core.Quantize
import java.io.File

object AppIcons {
  private const val SAMPLE = 48
  private const val PNG = 96
  private const val FALLBACK = 0xFFFFFFFF.toInt()
  private val PKG = Regex("^[a-zA-Z0-9_.]{1,200}$")
  private val cache = LruCache<String, Int>(64)

  /** The icon's dominant colour, lifted so it shows on a dark edge; white when the app has no icon (uninstalled). */
  fun colour(ctx: Context, pkg: String): Int {
    cache.get(pkg)?.let { return it }
    val c = runCatching {
      val bmp = render(ctx, pkg, SAMPLE)
      try {
        val px = IntArray(SAMPLE * SAMPLE)
        bmp.getPixels(px, 0, SAMPLE, 0, 0, SAMPLE, SAMPLE)
        Quantize.dominant(px, 1).firstOrNull()?.let(Quantize::lift)
      } finally {
        bmp.recycle()
      }
    }.getOrNull() ?: FALLBACK
    cache.put(pkg, c)
    return c
  }

  /** A file:// URI of a 96 px PNG in the cache dir, or null when the package is not installed. Blocking I/O. */
  fun iconUri(ctx: Context, pkg: String): String? {
    require(PKG.matches(pkg)) { "Bad package name" }
    // The file name carries the install time, so an updated app gets its new icon; an uninstalled one gets null, not a stale file.
    val updated = try {
      ctx.packageManager.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0)).lastUpdateTime
    } catch (e: PackageManager.NameNotFoundException) {
      return null
    }
    val dir = File(ctx.cacheDir, "app-icons").apply { mkdirs() }
    val name = "$pkg-$updated.png"
    val f = File(dir, name)
    if (!f.exists()) {
      val bmp = runCatching { render(ctx, pkg, PNG) }.getOrNull() ?: return null
      try {
        val tmp = File(dir, "$pkg.tmp")
        tmp.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        tmp.renameTo(f)
      } finally {
        bmp.recycle()
      }
      // Package names have no '-', so "$pkg-" matches only this package's older files; "$pkg.png" is the pre-0.4 name.
      dir.listFiles { _, n -> n != name && (n == "$pkg.png" || (n.startsWith("$pkg-") && n.endsWith(".png"))) }?.forEach { it.delete() }
    }
    return "file://${f.absolutePath}"
  }

  private fun render(ctx: Context, pkg: String, size: Int): Bitmap {
    val d = ctx.packageManager.getApplicationIcon(pkg)
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    d.setBounds(0, 0, size, size)
    d.draw(Canvas(bmp))
    return bmp
  }
}
