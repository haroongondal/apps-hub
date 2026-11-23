package expo.modules.haloengine.android

import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import android.os.Handler
import android.os.Looper
import expo.modules.haloengine.core.Probe

/** Visualizer(0) FFT tap. Create and release on the main thread; callbacks then arrive on it too. One instance per attempt. */
class AudioTap(
  private val ctx: Context,
  private val onFft: (fft: ByteArray, nonZero: Boolean) -> Unit,
  private val onInit: (ok: Boolean) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private var vis: Visualizer? = null
  private var frames = 0L
  private var nonZero = 0L

  private val tick = object : Runnable {
    override fun run() {
      ProbeLog.log(ctx, "audio", "fft frames=$frames nonzero=$nonZero")
      val v = vis ?: return
      // Another app taking over the audio effect leaves ours created but disabled.
      if (!runCatching { v.enabled }.getOrDefault(false)) {
        ProbeLog.log(ctx, "audio", "Visualizer disabled by the system or another app")
        stop()
        onInit(false)
        return
      }
      main.postDelayed(this, 5_000)
    }
  }

  private val listener = object : Visualizer.OnDataCaptureListener {
    override fun onWaveFormDataCapture(v: Visualizer?, waveform: ByteArray?, samplingRate: Int) = Unit

    override fun onFftDataCapture(v: Visualizer?, fft: ByteArray?, samplingRate: Int) {
      if (fft == null) return
      frames++
      val sound = Probe.anyNonZero(fft)
      if (sound && nonZero++ == 0L) ProbeLog.log(ctx, "audio", "first non-zero fft frame after frames=$frames rate=$samplingRate")
      onFft(fft, sound)
    }
  }

  fun start() {
    val granted = ctx.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    ProbeLog.log(ctx, "audio", "RECORD_AUDIO granted=$granted")
    var v: Visualizer? = null
    val ok = try {
      v = Visualizer(0)
      val size = v.setCaptureSize(Visualizer.getCaptureSizeRange()[1])
      val rate = Visualizer.getMaxCaptureRate()
      val set = v.setDataCaptureListener(listener, rate, false, true)
      val enabled = v.setEnabled(true)
      ProbeLog.log(ctx, "audio", "Visualizer(0) created captureSize=${v.captureSize} setCaptureSize=$size maxRate=$rate setListener=$set setEnabled=$enabled (0 is success)")
      if (enabled != Visualizer.SUCCESS || set != Visualizer.SUCCESS) throw IllegalStateException("Visualizer refused to start (setListener=$set setEnabled=$enabled)")
      vis = v
      main.postDelayed(tick, 5_000)
      true
    } catch (e: Exception) {
      ProbeLog.log(ctx, "audio", "Visualizer init FAILED ${e.javaClass.name}: ${e.message}")
      runCatching { v?.release() }
      false
    }
    onInit(ok)
  }

  fun stop() {
    main.removeCallbacks(tick)
    vis?.let { v ->
      runCatching { v.setEnabled(false) }
      runCatching { v.release() }
    }
    vis = null
    ProbeLog.log(ctx, "audio", "released frames=$frames nonzero=$nonZero")
  }
}
