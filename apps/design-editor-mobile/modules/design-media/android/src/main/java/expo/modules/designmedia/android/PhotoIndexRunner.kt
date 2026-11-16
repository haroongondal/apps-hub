package expo.modules.designmedia.android

import android.content.Context
import android.os.BatteryManager
import android.os.PowerManager
import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.ClipModels
import expo.modules.designmedia.core.PhotoIndexFile
import expo.modules.designmedia.core.PhotoRow
import expo.modules.designmedia.core.diff
import expo.modules.designmedia.core.pauseReason
import expo.modules.designmedia.core.quantize
import java.io.File

object PhotoIndexRunner {
  const val MODELS_MISSING = "models missing"
  private const val BATCH = 25
  private const val WAIT_S = 60

  fun start(req: Request, done: (Outcome) -> Unit): Runner = Worker(req.handler, done) { w -> index(req.context, w) }.start()

  private val LOCK = Any()

  @Volatile var waitingFor: String? = null
    private set

  fun stampFile(ctx: Context) = File(ctx.filesDir, "photo-index.stamp")

  // A cancelled job's thread may still be appending in its finally; a new job waits for it, or both would write the same rows.
  private fun index(ctx: Context, w: Worker): Outcome = synchronized(LOCK) {
    val models = File(ctx.filesDir, "models")
    if (!ClipModels.ALL.all { ClipModels.isReady(models, it) }) return Outcome.Failed(MODELS_MISSING)
    val file = File(ctx.filesDir, "photo-index.bin")
    // Taken before listing, so a photo added during the scan makes the next check ask for another scan.
    val stamp = Gallery.stamp(ctx)
    val d = diff(Gallery.list(ctx), PhotoIndexFile.read(file))
    PhotoIndexFile.rewrite(file, d.keep)
    if (d.toEmbed.isEmpty()) {
      AtomicFile(stampFile(ctx)).write(stamp)
      return Outcome.Written()
    }
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
    AtomicFile(stampFile(ctx)).write(stamp)
    Outcome.Written()
  }

  private fun waitWhileHotOrLow(ctx: Context, w: Worker) {
    try {
      while (true) {
        waitingFor = currentPauseReason(ctx) ?: break
        repeat(WAIT_S) {
          w.check()
          Thread.sleep(1_000)
        }
      }
    } finally {
      waitingFor = null
    }
  }

  private fun currentPauseReason(ctx: Context): String? {
    val battery = ctx.getSystemService(BatteryManager::class.java)
    // A phone that can't report its level returns a negative number; count it as full rather than pausing forever.
    val level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it >= 0 } ?: 100
    return pauseReason(level, battery.isCharging, ctx.getSystemService(PowerManager::class.java).currentThermalStatus)
  }
}
