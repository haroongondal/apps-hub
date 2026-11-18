package expo.modules.haloengine.android

import android.content.Context
import android.util.Log
import expo.modules.haloengine.core.Probe
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Append-only `filesDir/probe.log`, one timestamped line per event, trimmed to the last [MAX] lines. */
object ProbeLog {
  private const val MAX = 2000
  private const val TRIM_EVERY = 200
  private var writes = 0

  private fun file(ctx: Context) = File(ctx.applicationContext.filesDir, "probe.log")

  @Synchronized
  fun log(ctx: Context, tag: String, msg: String) {
    Log.i("Halo", "$tag $msg")
    runCatching {
      val f = file(ctx)
      val ts = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(Date())
      f.appendText("$ts $tag $msg\n")
      // First write of each process trims too, so a process that dies often still stays capped.
      if (writes++ % TRIM_EVERY == 0) f.writeText(Probe.capLines(f.readText(), MAX))
    }
  }

  @Synchronized
  fun read(ctx: Context): String = runCatching { file(ctx).takeIf { it.exists() }?.readText() }.getOrNull() ?: ""

  @Synchronized
  fun clear(ctx: Context) {
    runCatching { file(ctx).delete() }
  }
}
