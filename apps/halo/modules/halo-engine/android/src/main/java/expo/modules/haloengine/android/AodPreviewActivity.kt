package expo.modules.haloengine.android

import android.app.Activity
import android.os.Bundle
import expo.modules.haloengine.core.Faces
import expo.modules.haloengine.core.Themes
import java.time.LocalTime

/** The always-on content over the app, for the settings screens. Never shows over the keyguard; back or a tap leaves. */
class AodPreviewActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val s = HaloService.current(this)
    val id = intent.getStringExtra(EXTRA_THEME)
    val now = LocalTime.now()
    val base = s.themes.firstOrNull { it.id == id } ?: Themes.resolve(s.aod, s.themes, now.hour * 60 + now.minute)
    val theme = Themes.usable(base, Faces.all.map { it().id }.toSet(), Backgrounds.exists(this, base.id))
    setContentView(AodContent(this, theme, s, preview = true, onLeave = { finish() }))
    AodContent.fullScreen(window)
  }

  companion object {
    const val EXTRA_THEME = "themeId"
  }
}
