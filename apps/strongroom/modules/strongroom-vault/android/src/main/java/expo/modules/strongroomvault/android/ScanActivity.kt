package expo.modules.strongroomvault.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.LinearLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatButton
import androidx.appcompat.widget.AppCompatTextView
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import expo.modules.strongroomvault.core.Otp
import org.json.JSONException
import org.json.JSONObject

/** The raw URI a confirmed scan returns to the module, which hands it to Add/Edit's save. */
internal const val SCAN_TOTP_EXTRA = "expo.modules.strongroomvault.totp"

/**
 * The §15.4 scan screen: the camera reads the site's QR, Otp parses it, and the parsed
 * issuer, account, algorithm, digits and period are shown before the URI is handed over —
 * the vault write stays with Add/Edit's save. FLAG_SECURE: the QR on the other screen is a
 * secret, and a screenshot of ours would carry it. The camera is requested here, at scan
 * time only, and QR is the only format looked for.
 */
class ScanActivity : AppCompatActivity() {
  private lateinit var root: LinearLayout
  private lateinit var barcode: DecoratedBarcodeView
  private lateinit var panel: LinearLayout
  private val colors by lazy { palette() }

  private enum class State { WAITING, SCANNING, CONFIRMING }

  private var state = State.WAITING

  private val cameraRequest = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) startScanning() else denied()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    window.setHideOverlayWindows(true)
    super.onCreate(savedInstanceState)
    root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      colors["bg"]?.let(::setBackgroundColor)
      setOnApplyWindowInsetsListener { v, insets ->
        val bars = insets.getInsets(WindowInsets.Type.systemBars())
        v.setPadding(bars.left + dp(24), bars.top + dp(24), bars.right + dp(24), bars.bottom + dp(24))
        insets
      }
    }
    setContentView(root)
    findViewById<View>(android.R.id.content).importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
    if (Build.VERSION.SDK_INT >= 34) window.decorView.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)

    title = "Scan QR code"
    heading("Point the camera at the QR code the site shows for its authenticator app.", colors["muted"])
    barcode = DecoratedBarcodeView(this).apply {
      // Only QR: a site's two-step page shows its code as a QR, and a stray barcode should not be read as one.
      decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
      // The library's default status text belongs to its capture activity; this screen's guidance is the heading above.
      setStatusText("")
    }
    barcode.decodeContinuous { result -> decoded(result) }
    root.addView(barcode, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    root.addView(panel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    // Every state keeps one Cancel: the panel below is rebuilt as scanning, confirm and refusals replace each other.
    add(button("Cancel") { finish() }, into = root)

    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startScanning() else cameraRequest.launch(Manifest.permission.CAMERA)
  }

  override fun onResume() {
    super.onResume()
    if (state == State.SCANNING) barcode.resume()
  }

  override fun onPause() {
    barcode.pause()
    super.onPause()
  }

  private fun startScanning() {
    state = State.SCANNING
    panel.removeAllViews()
    barcode.resume()
  }

  private fun denied() {
    state = State.WAITING
    panel.removeAllViews()
    line("Strongroom can't scan without the camera. Allow the camera permission for Strongroom in the phone's settings.", colors["text"])
    add(button("Open settings", primary = true) {
      startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.fromParts("package", packageName, null)))
    })
  }

  private fun decoded(result: BarcodeResult) {
    if (state != State.SCANNING) return
    val uri = result.text.trim()
    val totp = Otp.parse(uri)
    if (totp == null) {
      // Keep the camera paused so the same code doesn't immediately re-trigger; the button resumes.
      barcode.pause()
      state = State.WAITING
      panel.removeAllViews()
      line(Otp.refusal(uri) ?: "This QR is not an authenticator code.", colors["danger"])
      add(button("Try again", primary = true) { startScanning() })
      return
    }
    barcode.pause()
    state = State.CONFIRMING
    panel.removeAllViews()
    // §15.4: what was parsed, shown before anything is stored.
    line(listOfNotNull(totp.issuer, totp.account).joinToString(" · ").ifEmpty { "Authenticator code" }, colors["text"], bold = true)
    line("${totp.algorithm.name}, ${totp.digits} digits, every ${totp.period} s", colors["muted"])
    add(button("Add this code", primary = true) {
      setResult(RESULT_OK, Intent().putExtra(SCAN_TOTP_EXTRA, totp.raw))
      finish()
    })
    add(button("Scan again") { startScanning() })
  }

  private fun line(text: CharSequence, color: Int?, bold: Boolean = false) {
    panel.addView(AppCompatTextView(this).apply {
      this.text = text
      textSize = 16f
      setPadding(0, dp(12), 0, 0)
      color?.let(::setTextColor)
      if (bold) setTypeface(typeface, Typeface.BOLD)
    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
  }

  private fun heading(text: CharSequence, color: Int?) {
    root.addView(AppCompatTextView(this).apply {
      this.text = text
      textSize = 16f
      color?.let(::setTextColor)
    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
  }

  private fun button(label: String, primary: Boolean = false, onClick: () -> Unit): AppCompatButton {
    val b = if (primary) AppCompatButton(this) else AppCompatButton(this, null, androidx.appcompat.R.attr.borderlessButtonStyle)
    b.text = label
    b.isAllCaps = false
    if (primary) {
      colors["accent"]?.let { b.backgroundTintList = ColorStateList.valueOf(it) }
      colors["onAccent"]?.let(b::setTextColor)
    } else {
      colors["accent"]?.let(b::setTextColor)
    }
    b.setOnClickListener { onClick() }
    return b
  }

  private fun add(b: AppCompatButton, into: LinearLayout = panel) {
    b.filterTouchesWhenObscured = true
    into.addView(b, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
  }

  private fun palette(): Map<String, Int> {
    val json = VaultHolder.prefs(this).getString(VaultHolder.PALETTE, null) ?: return emptyMap()
    return try {
      val scheme = JSONObject(json).optJSONObject(if (resources.configuration.isNightModeActive) "dark" else "light") ?: return emptyMap()
      PALETTE_KEYS.mapNotNull { k -> scheme.optString(k).takeIf(HEX::matches)?.let { k to Color.parseColor(it) } }.toMap()
    } catch (e: JSONException) {
      emptyMap()
    }
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  private companion object {
    val PALETTE_KEYS = listOf("bg", "text", "muted", "accent", "onAccent", "danger")
    val HEX = Regex("#[0-9A-Fa-f]{6}")
  }
}
