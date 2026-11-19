package expo.modules.notchisland.android

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.session.MediaController
import android.text.TextUtils
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.notchisland.R
import expo.modules.notchisland.core.PillGeometry

// Art, title and artist, then previous, play/pause and next as large round buttons.
class MediaRow(context: Context, private val density: Float) : LinearLayout(context) {
  private var controller: MediaController? = null
  private var playing = false

  private val art = ImageView(context).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    background = GradientDrawable().apply { cornerRadius = 12 * density; setColor(0x33FFFFFF) }
    clipToOutline = true
  }
  private val title = line(15f, Color.WHITE).apply { setTypeface(typeface, Typeface.BOLD) }
  private val artist = line(13f, 0xA6FFFFFF.toInt())
  private val previous = roundButton(context, R.drawable.notch_previous, "Previous") { controller?.transportControls?.skipToPrevious() }
  private val playPause = roundButton(context, R.drawable.notch_play, "Play") {
    controller?.transportControls?.let { if (playing) it.pause() else it.play() }
  }
  private val next = roundButton(context, R.drawable.notch_next, "Next") { controller?.transportControls?.skipToNext() }

  init {
    orientation = VERTICAL
    val side = dp(PillGeometry.INSET_SIDE_DP)
    setPadding(side, 0, side, 0)
    val top = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    top.addView(art, LayoutParams(dp(64), dp(64)))
    val texts = LinearLayout(context).apply {
      orientation = VERTICAL
      addView(title)
      addView(artist)
    }
    top.addView(texts, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(12) })
    addView(top, LayoutParams(LayoutParams.MATCH_PARENT, dp(64)))

    val controls = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER }
    for ((i, b) in listOf(previous, playPause, next).withIndex()) {
      controls.addView(b, LayoutParams(dp(52), dp(52)).apply { if (i > 0) leftMargin = dp(28) })
    }
    addView(controls, LayoutParams(LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(12) })
  }

  fun isVisibleFor(info: MediaInfo?): Boolean = !info?.title.isNullOrBlank()

  fun bind(info: MediaInfo?, accent: Int, controller: MediaController?) {
    this.controller = controller
    visibility = if (isVisibleFor(info)) VISIBLE else GONE
    if (info == null) return
    playing = info.playing
    art.setImageBitmap(info.art)
    title.text = info.title
    artist.text = info.artist.orEmpty()
    artist.visibility = if (info.artist.isNullOrBlank()) GONE else VISIBLE
    playPause.setImageResource(if (playing) R.drawable.notch_pause else R.drawable.notch_play)
    playPause.contentDescription = if (playing) "Pause" else "Play"
    playPause.paint(accent, Color.BLACK)
    previous.paint(SOFT, Color.WHITE)
    next.paint(SOFT, Color.WHITE)
  }

  private fun dp(v: Int) = (v * density).toInt()

  private fun line(size: Float, colour: Int) = TextView(context).apply {
    textSize = size
    setTextColor(colour)
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }
}
