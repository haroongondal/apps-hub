package expo.modules.pdfscan

import android.Manifest
import android.graphics.Color
import android.net.Uri
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.pdfscan.android.CardSheet
import expo.modules.pdfscan.android.Gallery
import expo.modules.pdfscan.android.ImageImport
import expo.modules.pdfscan.android.PageProcessor
import expo.modules.pdfscan.android.ProcessRequest
import expo.modules.pdfscan.android.ScanCameraView
import expo.modules.pdfscan.android.ShareImages
import expo.modules.pdfscan.android.SheetRequest
import expo.modules.pdfscan.android.asFile
import expo.modules.pdfscan.android.existingFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class PdfScanModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfScan")

    AsyncFunction("getCameraPermission") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }
    AsyncFunction("requestCameraPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }
    AsyncFunction("importImage") Coroutine { src: String, dest: String ->
      withContext(Dispatchers.Default) {
        val out = asFile(dest)
        val (w, h, det) = ImageImport.importUpright(existingFile(src), out)
        mapOf("uri" to "file://${out.absolutePath}", "width" to w, "height" to h, "quad" to det?.quad?.toList())
      }
    }
    AsyncFunction("detectQuad") Coroutine { src: String, card: Boolean? ->
      withContext(Dispatchers.Default) { ImageImport.detectFile(existingFile(src))?.quad?.toList() }
    }
    AsyncFunction("processPage") Coroutine { req: ProcessRequest ->
      withContext(Dispatchers.Default) { PageProcessor.process(req) }
    }
    AsyncFunction("composeCardSheet") Coroutine { req: SheetRequest ->
      withContext(Dispatchers.Default) { CardSheet.compose(req) }
    }
    AsyncFunction("saveImagesToGallery") Coroutine { paths: List<String>, album: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("the app isn't running")
      withContext(Dispatchers.IO) { Gallery.save(context, paths, album) }
    }
    AsyncFunction("shareImages") { paths: List<String>, chooserTitle: String ->
      ShareImages.share(appContext, paths, chooserTitle)
    }

    View(ScanCameraView::class) {
      Events("onQuad", "onCapture", "onCameraError")
      Prop("active") { view: ScanCameraView, on: Boolean -> view.setActive(on) }
      Prop("autoCapture") { view: ScanCameraView, on: Boolean -> view.autoCapture = on }
      Prop("torch") { view: ScanCameraView, on: Boolean -> view.setTorch(on) }
      Prop("accentColor") { view: ScanCameraView, hex: String -> view.outlineColor = Color.parseColor(hex) }
      Prop("sessionDir") { view: ScanCameraView, uri: String -> view.sessionDir = Uri.parse(uri).path?.let(::File) }
      AsyncFunction("capture") { view: ScanCameraView -> view.captureManual() }
      OnViewDestroys { view: ScanCameraView -> view.release() }
    }
  }
}
