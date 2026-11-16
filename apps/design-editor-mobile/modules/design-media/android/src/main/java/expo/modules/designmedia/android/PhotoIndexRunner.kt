package expo.modules.designmedia.android

import android.content.Context
import android.os.BatteryManager
import android.os.PowerManager
import expo.modules.designmedia.core.ClipModels
import expo.modules.designmedia.core.PhotoIndexFile
import expo.modules.designmedia.core.PhotoRow
import expo.modules.designmedia.core.diff
import expo.modules.designmedia.core.quantize
import expo.modules.designmedia.core.shouldPause
import java.io.File

object PhotoIndexRunner {
  const val MODELS_MISSING = "models missing"
  private const val BATCH = 25
  private const val WAIT_S = 60

  fun start(req: Request, done: (Outcome) -> Unit): Runner = Worker(req.handler, done) { w -> index(req.context, w) }.start()

  private val LOCK = Any()

  // A cancelled job's thread may still be appending in its finally; a new job waits for it, or both would write the same rows.
  private fun index(ctx: Context, w: Worker): Outcome = synchronized(LOCK) {
    val models = File(ctx.filesDir, "models")
    if (!ClipModels.ALL.all { ClipModels.isReady(models, it) }) return Outcome.Failed(MODELS_MISSING)
    val file = File(ctx.filesDir, "photo-index.bin")
    val d = diff(Gallery.list(ctx), PhotoIndexFile.read(file))
    PhotoIndexFile.rewrite(file, d.keep)
    if (d.toEmbed.isEmpty()) return Outcome.Written()
    val session = ClipSessions.image(ctx)
    val batch = ArrayList<PhotoRow>(BATCH)
    try {
      d.toEmbed.forEachIndexed { i, key ->
        w.check()
        waitWhileHotOrLow(ctx, w)
        Gallery.tensor(ctx, key.id)?.let { batch.add(PhotoRow(key, quantize(ClipSessions.embedImage(session, it)))) }
        if (batch.size == BATCH) {
          PhotoIndexFile.append(file, batch)
          batch.clear()
        }
        w.report((i + 1).toDouble() / d.toEmbed.size)
      }
    } finally {
      if (batch.isNotEmpty()) PhotoIndexFile.append(file, batch)
      ClipSessions.releaseImage()
    }
    Outcome.Written()
  }

  private fun waitWhileHotOrLow(ctx: Context, w: Worker) {
    while (mustPause(ctx)) repeat(WAIT_S) {
      w.check()
      Thread.sleep(1_000)
    }
  }

  private fun mustPause(ctx: Context): Boolean {
    val battery = ctx.getSystemService(BatteryManager::class.java)
    // A phone that can't report its level returns a negative number; count it as full rather than pausing forever.
    val level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it >= 0 } ?: 100
    return shouldPause(level, battery.isCharging, ctx.getSystemService(PowerManager::class.java).currentThermalStatus)
  }
}
