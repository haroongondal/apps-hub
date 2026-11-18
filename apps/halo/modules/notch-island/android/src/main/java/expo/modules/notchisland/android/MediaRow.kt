package expo.modules.notchisland.android

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.session.MediaController
import android.text.TextUtils
import android.view.Gravity
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

class MediaRow(context: Context, private val density: Float) : LinearLayout(context) {
  private var controller: MediaController? = null
  private var playing = false

  private val art = ImageView(context).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    background = GradientDrawable().apply { cornerRadius = 8 * density; setColor(0x33FFFFFF) }
    clipToOutline = true
  }
  private val title = line(14f, Color.WHITE)
  private val artist = line(12f, 0xB3FFFFFF.toInt())
  private val previous = button(android.R.drawable.ic_media_previous, "Previous") { controller?.transportControls?.skipToPrevious() }
  private val playPause = button(android.R.drawable.ic_media_play, "Play") {
    controller?.transportControls?.let { if (playing) it.pause() else it.play() }
  }
  private val next = button(android.R.drawable.ic_media_next, "Next") { controller?.transportControls?.skipToNext() }

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    val pad = dp(16)
    setPadding(pad, dp(6), pad - dp(4), dp(6))
    addView(art, LayoutParams(dp(48), dp(48)).apply { rightMargin = dp(12) })
    val texts = LinearLayout(context).apply {
      orientation = VERTICAL
      addView(title)
      addView(artist)
    }
    addView(texts, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    for (b in listOf(previous, playPause, next)) addView(b, LayoutParams(dp(44), dp(44)))
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
    playPause.setImageResource(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
    playPause.contentDescription = if (playing) "Pause" else "Play"
    playPause.imageTintList = ColorStateList.valueOf(accent)
  }

  private fun dp(v: Int) = (v * density).toInt()

  private fun line(size: Float, colour: Int) = TextView(context).apply {
    textSize = size
    setTextColor(colour)
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }

  private fun button(icon: Int, label: String, onTap: () -> Unit) = ImageButton(context).apply {
    setImageResource(icon)
    contentDescription = label
    background = null
    imageTintList = ColorStateList.valueOf(Color.WHITE)
    setOnClickListener { onTap() }
  }
}
