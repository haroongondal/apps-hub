package expo.modules.haloengine.android

import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import android.os.Handler
import android.os.Looper
import expo.modules.haloengine.core.Probe

/** Spike: Visualizer(0) FFT tap. Create and release on the main thread; callbacks then arrive on it too. */
class AudioTap(private val ctx: Context, private val onLevel: (Float) -> Unit, private val onChange: () -> Unit) {
  private val main = Handler(Looper.getMainLooper())
  private var vis: Visualizer? = null
  private var frames = 0L
  private var nonZero = 0L
  @Volatile var initFailed = false
    private set

  val status: String get() = Probe.audioStatus(initFailed, nonZero)

  private val tick = object : Runnable {
    override fun run() {
      ProbeLog.log(ctx, "audio", "fft frames=$frames nonzero=$nonZero")
      main.postDelayed(this, 5_000)
    }
  }

  private val listener = object : Visualizer.OnDataCaptureListener {
    override fun onWaveFormDataCapture(v: Visualizer?, waveform: ByteArray?, samplingRate: Int) = Unit

    override fun onFftDataCapture(v: Visualizer?, fft: ByteArray?, samplingRate: Int) {
      if (fft == null) return
      frames++
      if (Probe.anyNonZero(fft)) {
        if (nonZero++ == 0L) {
          ProbeLog.log(ctx, "audio", "first non-zero fft frame after frames=$frames rate=$samplingRate")
          onChange()
        }
        onLevel(Probe.level(fft))
      } else {
        onLevel(0f)
      }
    }
  }

  fun start() {
    val granted = ctx.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    ProbeLog.log(ctx, "audio", "RECORD_AUDIO granted=$granted")
    var v: Visualizer? = null
    try {
      v = Visualizer(0)
      val size = v.setCaptureSize(Visualizer.getCaptureSizeRange()[1])
      val rate = Visualizer.getMaxCaptureRate()
      val set = v.setDataCaptureListener(listener, rate, false, true)
      val enabled = v.setEnabled(true)
      ProbeLog.log(ctx, "audio", "Visualizer(0) created captureSize=${v.captureSize} setCaptureSize=$size maxRate=$rate setListener=$set setEnabled=$enabled (0 is success)")
      if (enabled != Visualizer.SUCCESS || set != Visualizer.SUCCESS) throw IllegalStateException("Visualizer refused to start (setListener=$set setEnabled=$enabled)")
      vis = v
      main.postDelayed(tick, 5_000)
    } catch (e: Exception) {
      initFailed = true
      ProbeLog.log(ctx, "audio", "Visualizer init FAILED ${e.javaClass.name}: ${e.message}")
      runCatching { v?.release() }
    }
    onChange()
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
