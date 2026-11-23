package expo.modules.notchisland.android

import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.Build
import android.text.TextUtils
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.core.PillGeometry

// The app's icon, then the app name, the sender and one line of the message. A tap opens the conversation.
class MessageRow(context: Context, density: Float) : LinearLayout(context) {
  private val icon = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
  private val app = line(11f, 0x99FFFFFF.toInt())
  private val sender = line(15f, Color.WHITE).apply { setTypeface(typeface, Typeface.BOLD) }
  private val text = line(13f, 0xBFFFFFFF.toInt())
  private var info: MessageInfo? = null
  private var pkg: String? = null
  private var label = ""
  private var appIcon: Drawable? = null
  var onOpened: (() -> Unit)? = null

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    val side = (PillGeometry.INSET_SIDE_DP * density).toInt()
    setPadding(side, 0, side, 0)
    val size = (28 * density).toInt()
    addView(icon, LayoutParams(size, size).apply { rightMargin = (12 * density).toInt() })
    val lines = LinearLayout(context).apply { orientation = VERTICAL }
    lines.addView(app)
    lines.addView(sender)
    lines.addView(text)
    addView(lines, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    setOnClickListener { open() }
  }

  fun bind(m: MessageInfo) {
    info = m
    if (m.snap.pkg != pkg) {
      pkg = m.snap.pkg
      val pm = context.packageManager
      label = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(m.snap.pkg, PackageManager.ApplicationInfoFlags.of(0))).toString() }.getOrDefault("")
      appIcon = runCatching { pm.getApplicationIcon(m.snap.pkg) }.getOrNull()
    }
    icon.setImageDrawable(appIcon)
    app.text = label
    app.visibility = if (label.isEmpty()) GONE else VISIBLE
    sender.text = m.snap.sender
    text.text = m.snap.line
    text.visibility = if (m.snap.line.isEmpty()) GONE else VISIBLE
    contentDescription = listOf(label, m.snap.sender, m.snap.line).filter { it.isNotEmpty() }.joinToString(", ")
  }

  // Android 14+ needs the sender to lend its background-start right; the overlay is a visible window, so it has one.
  private fun open() {
    val m = info ?: return
    val options = if (Build.VERSION.SDK_INT >= 34) {
      @Suppress("DEPRECATION")
      ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle()
    } else null
    val sent = m.tap?.let { runCatching { it.send(context, 0, null, null, null, null, options) }.isSuccess } ?: false
    if (!sent) {
      context.packageManager.getLaunchIntentForPackage(m.snap.pkg)?.let { runCatching { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    }
    onOpened?.invoke()
  }

  private fun line(size: Float, colour: Int) = TextView(context).apply {
    textSize = size
    setTextColor(colour)
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }
}
