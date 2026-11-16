package expo.modules.pdfscan

import android.Manifest
import android.graphics.Color
import android.net.Uri
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.pdfscan.android.ScanCameraView
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
