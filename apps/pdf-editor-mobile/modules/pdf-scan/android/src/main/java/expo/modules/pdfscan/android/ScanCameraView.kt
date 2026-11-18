package expo.modules.pdfscan.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceOrientedMeteringPointFactory
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.pdfscan.core.Detection
import expo.modules.pdfscan.core.Luma
import expo.modules.pdfscan.core.QuadDetector
import expo.modules.pdfscan.core.QuadStabilizer
import expo.modules.pdfscan.core.Quads
import expo.modules.pdfscan.core.ScanHint
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.min
import kotlin.math.roundToInt

class ScanCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onQuad by EventDispatcher<Map<String, Any?>>()
  private val onCapture by EventDispatcher<Map<String, Any?>>()
  private val onCameraError by EventDispatcher<Map<String, Any?>>()

  override val shouldUseAndroidLayout = true

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FIT_CENTER
    setBackgroundColor(Color.TRANSPARENT)
  }
  private val overlay = Overlay(context)
  private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  @Volatile private var detector = QuadDetector()
  private val stabilizer = QuadStabilizer { SystemClock.elapsedRealtime() }

  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  private var imageCapture: ImageCapture? = null
  private var lumaBuffer = ByteArray(0)

  private var active = false
  private var bound = false
  private var torch = false
  @Volatile var autoCapture = true
  @Volatile var cardMode = false
    set(on) {
      if (on == field) return
      field = on
      detector = QuadDetector(detectorConfig(on))
      rearm()
    }
  var sessionDir: File? = null
  var outlineColor: Int
    get() = overlay.color
    set(value) { overlay.color = value; overlay.invalidate() }

  @Volatile private var afState: Int? = null
  @Volatile private var fixedFocus = false
  @Volatile private var capturing = false
  @Volatile private var lastUpright: Detection? = null
  private var lastEmitAt = 0L
  private var lastEmitted: Triple<ScanHint, Boolean, Int>? = null
  private var lastLoggedAt = 0L

  init {
    val frame = FrameLayout(context)
    frame.addView(previewView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    frame.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    addView(frame, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  fun setActive(on: Boolean) {
    if (on == active) return
    active = on
    if (on) bind() else unbind()
  }

  fun setTorch(on: Boolean) {
    torch = on
    camera?.cameraControl?.enableTorch(on)
  }

  fun captureManual() {
    val det = lastUpright
    analysisExecutor.execute { stabilizer.manualCapture(det) }
    takePicture(det, auto = false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (active && !bound) bind()
  }

  override fun onDetachedFromWindow() {
    unbind()
    super.onDetachedFromWindow()
  }

  private fun error(code: String, message: String) {
    onCameraError(mapOf("code" to code, "message" to message))
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun bind() {
    if (bound) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      error("permission", "Camera access is off.")
      return
    }
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      error("unavailable", "The camera can't start without a screen.")
      return
    }
    bound = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!active || !bound) return@addListener
      try {
        val p = future.get()
        provider = p
        val fourThree = AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
        val previewBuilder = Preview.Builder()
          .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(fourThree).build())
        Camera2Interop.Extender(previewBuilder).setSessionCaptureCallback(object : CameraCaptureSession.CaptureCallback() {
          override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
            afState = result.get(CaptureResult.CONTROL_AF_STATE)
          }
        })
        val pv = previewBuilder.build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val an = ImageAnalysis.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(fourThree)
              .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
              .build(),
          )
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
          .build()
        an.setAnalyzer(analysisExecutor) { image -> analyze(image) }
        val cap = ImageCapture.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(fourThree)
              .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
              .build(),
          )
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .setJpegQuality(95)
          .build()
        p.unbindAll()
        val cam = p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, pv, an, cap)
        camera = cam
        preview = pv
        analysis = an
        imageCapture = cap
        analysisExecutor.execute { stabilizer.reset() }
        val info = Camera2CameraInfo.from(cam.cameraInfo)
        fixedFocus = (info.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f) == 0f
        cam.cameraControl.enableTorch(torch)
        // Spike S1: what the phone actually gave us.
        Log.i(TAG, "S1 level=${info.getCameraCharacteristic(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)} " +
          "preview=${pv.resolutionInfo?.resolution} analysis=${an.resolutionInfo?.resolution} " +
          "capture=${cap.resolutionInfo?.resolution} crop=${cap.resolutionInfo?.cropRect}/${an.resolutionInfo?.cropRect} fixedFocus=$fixedFocus")
      } catch (e: Exception) {
        Log.w(TAG, "bind failed", e)
        bound = false
        error("unavailable", "The camera didn't start: ${e.message ?: e.javaClass.simpleName}")
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun unbind() {
    bound = false
    val p = provider ?: return
    listOfNotNull(preview, analysis, imageCapture).forEach { runCatching { p.unbind(it) } }
    analysis?.clearAnalyzer()
    camera = null
    preview = null
    analysis = null
    imageCapture = null
    lastUpright = null
    overlay.post { overlay.show(null, 0.0, 0.75) }
  }

  private fun analyze(image: ImageProxy) {
    try {
      val plane = image.planes[0]
      val stride = plane.rowStride
      val need = stride * (image.height - 1) + image.width
      if (lumaBuffer.size < need) lumaBuffer = ByteArray(need)
      val buf = plane.buffer
      buf.rewind()
      buf.get(lumaBuffer, 0, min(need, buf.remaining()))
      val started = SystemClock.elapsedRealtimeNanos()
      val d = detector
      val raw = d.detect(Luma(lumaBuffer, image.width, image.height, stride))
      val ms = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000.0
      val rotation = image.imageInfo.rotationDegrees
      val det = raw?.rotated(rotation)
      lastUpright = det
      val af = afState
      val focused = fixedFocus || (af != CaptureResult.CONTROL_AF_STATE_ACTIVE_SCAN && af != CaptureResult.CONTROL_AF_STATE_PASSIVE_SCAN)
      val step = stabilizer.update(det, focused, autoCapture)
      val now = SystemClock.elapsedRealtime()
      if (now - lastLoggedAt > 1000) {
        lastLoggedAt = now
        Log.d(TAG, "S2 detect=${"%.1f".format(ms)}ms high=${d.lastHigh} sharp=${raw?.sharpness?.roundToInt()} af=$af hint=${step.hint} ${image.width}x${image.height} rot=$rotation")
      }
      if (step.enteredHolding && raw != null && !fixedFocus) focusOn(raw.quad)
      val aspect = if (rotation % 180 == 0) image.width.toDouble() / image.height else image.height.toDouble() / image.width
      overlay.post { overlay.show(step.quad, step.steady, aspect) }
      emitQuad(step.quad, step.steady, step.hint, now)
      if (step.fire && autoCapture) post { takePicture(det, auto = true) }
    } catch (e: Exception) {
      Log.w(TAG, "analysis failed", e)
    } finally {
      image.close()
    }
  }

  private fun focusOn(sensorQuad: DoubleArray) {
    val an = analysis ?: return
    val cx = ((sensorQuad[0] + sensorQuad[2] + sensorQuad[4] + sensorQuad[6]) / 4).toFloat()
    val cy = ((sensorQuad[1] + sensorQuad[3] + sensorQuad[5] + sensorQuad[7]) / 4).toFloat()
    val point = SurfaceOrientedMeteringPointFactory(1f, 1f, an).createPoint(cx, cy)
    camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF).build())
  }

  private fun emitQuad(quad: DoubleArray?, steady: Double, hint: ScanHint, now: Long) {
    val key = Triple(hint, quad != null, (steady * 20).toInt())
    if (key == lastEmitted || now - lastEmitAt < 100) return
    lastEmitAt = now
    lastEmitted = key
    onQuad(mapOf("quad" to quad?.toList(), "steady" to steady, "hint" to hint.js))
  }

  private fun takePicture(det: Detection?, auto: Boolean) {
    val cap = imageCapture
    val dir = sessionDir
    if (cap == null || dir == null || capturing) return
    capturing = true
    val ms = System.currentTimeMillis()
    val raw = File(context.cacheDir, "cap-$ms.jpg")
    cap.takePicture(ImageCapture.OutputFileOptions.Builder(raw).build(), saveExecutor, object : ImageCapture.OnImageSavedCallback {
      override fun onImageSaved(output: ImageCapture.OutputFileResults) {
        try {
          dir.mkdirs()
          val dest = File(dir, "cap-$ms.jpg")
          val started = SystemClock.elapsedRealtime()
          val (bw, bh, refined) = ImageImport.importUpright(raw, dest, detectorConfig(cardMode))
          val quad = pickQuad(refined, det)
          Log.d(TAG, "capture import ${SystemClock.elapsedRealtime() - started}ms ${bw}x$bh refined=${refined != null}")
          onCapture(mapOf("uri" to "file://${dest.absolutePath}", "width" to bw, "height" to bh, "quad" to quad?.toList(), "auto" to auto))
        } catch (e: Throwable) {
          Log.w(TAG, "capture import failed", e)
          rearm()
          error("capture_failed", "The photo couldn't be saved: ${e.message ?: e.javaClass.simpleName}")
        } finally {
          raw.delete()
          capturing = false
        }
      }

      override fun onError(exception: ImageCaptureException) {
        capturing = false
        rearm()
        error("capture_failed", "The photo wasn't taken: ${exception.message ?: "camera error"}")
      }
    })
  }

  private fun rearm() {
    runCatching { analysisExecutor.execute { stabilizer.reset() } } // rejected once the view is released
  }

  private fun pickQuad(refined: Detection?, live: Detection?): DoubleArray? {
    if (refined == null) return live?.quad
    if (live == null) return refined.quad
    return if (Quads.maxCornerShareOfDiagonal(refined.quad, live.quad, refined.aspect) <= 0.03) refined.quad else live.quad
  }

  fun release() {
    unbind()
    analysisExecutor.shutdown()
  }

  private class Overlay(context: Context) : View(context) {
    var color = Color.WHITE
    private var quad: DoubleArray? = null
    private var steady = 0.0
    private var aspect = 0.75
    private val density = resources.displayMetrics.density
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2 * density; strokeJoin = Paint.Join.ROUND }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 4 * density; strokeCap = Paint.Cap.ROUND }
    private val path = Path()
    private val oval = RectF()

    fun show(q: DoubleArray?, s: Double, a: Double) {
      quad = q
      steady = s
      aspect = a
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val q = quad ?: return
      // PreviewView FIT_CENTER letterboxes the upright frame inside this view.
      val vw = width.toFloat()
      val vh = height.toFloat()
      val fw: Float
      val fh: Float
      if (vw / vh > aspect) { fh = vh; fw = (vh * aspect).toFloat() } else { fw = vw; fh = (vw / aspect).toFloat() }
      val ox = (vw - fw) / 2
      val oy = (vh - fh) / 2
      path.reset()
      for (k in 0 until 4) {
        val x = ox + q[k * 2].toFloat() * fw
        val y = oy + q[k * 2 + 1].toFloat() * fh
        if (k == 0) path.moveTo(x, y) else path.lineTo(x, y)
      }
      path.close()
      fill.color = (color and 0x00FFFFFF) or (0x33 shl 24)
      stroke.color = color
      ring.color = color
      canvas.drawPath(path, fill)
      canvas.drawPath(path, stroke)
      if (steady > 0) {
        val cx = ox + ((q[0] + q[2] + q[4] + q[6]) / 4).toFloat() * fw
        val cy = oy + ((q[1] + q[3] + q[5] + q[7]) / 4).toFloat() * fh
        val r = 28 * density
        oval.set(cx - r, cy - r, cx + r, cy + r)
        canvas.drawArc(oval, -90f, (steady * 360).toFloat(), false, ring)
      }
    }
  }

  companion object {
    private const val TAG = "PdfScan"
    // One for the process, never shut down: CameraX may still deliver a save after the view is released.
    private val saveExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  }
}
