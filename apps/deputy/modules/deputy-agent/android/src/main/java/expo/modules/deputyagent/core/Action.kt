package expo.modules.deputyagent.core

const val SYSTEM_UI = "com.android.systemui"

data class Bounds(val left: Int, val top: Int, val right: Int, val bottom: Int)

data class NodeRef(
  val pkg: String,
  val text: String?,
  val desc: String?,
  val hint: String?,
  val viewId: String?,
  val bounds: Bounds,
  val clickable: Boolean = false,
  val editable: Boolean = false,
  val scrollable: Boolean = false,
  val password: Boolean = false,
  val visible: Boolean = true,
  val depth: Int = 0,
  val childText: String? = null,
  /** A switch or checkbox: whether it is on; null for anything that can't be checked. */
  val checked: Boolean? = null,
) {
  val label: String? get() = text?.takeIf { it.isNotBlank() } ?: desc?.takeIf { it.isNotBlank() } ?: childText
}

/** `showsSelf`: Deputy's name is on screen, as on its own App info page. */
data class ScreenContext(val pkg: String, val title: String?, val showsSelf: Boolean, val unread: List<Bounds> = emptyList())

enum class Direction { UP, DOWN, LEFT, RIGHT }

enum class Button { BACK, HOME, RECENTS, NOTIFICATIONS }

/** A parsed model tool call (SPEC §6); indices refer to the latest observation only. */
sealed interface Action {
  data class OpenApp(val pkg: String) : Action
  data class OpenLink(val url: String, val handler: String? = null) : Action
  data class Tap(val index: Int) : Action
  data class TapAt(val x: Int, val y: Int) : Action
  data class LongPress(val index: Int) : Action
  data class TypeText(val index: Int, val text: String, val pressEnter: Boolean) : Action
  data class Scroll(val direction: Direction, val index: Int?) : Action
  data class Swipe(val direction: Direction) : Action
  data class Press(val button: Button) : Action
  data class Wait(val seconds: Int) : Action
  data object Look : Action
  data class OpenSettings(val page: String) : Action
  /** `handler` is the clock app the phone would ask, filled in before the policy judges the step. */
  data class SetAlarm(val hour: Int, val minute: Int, val label: String?, val handler: String? = null) : Action
  data class SetTimer(val seconds: Int, val label: String?, val handler: String? = null) : Action
}
