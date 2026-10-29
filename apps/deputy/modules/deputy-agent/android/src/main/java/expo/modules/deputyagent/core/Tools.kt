package expo.modules.deputyagent.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

sealed interface Call {
  data class Act(val action: Action, val irreversible: Boolean) : Call
  data class OpenApp(val name: String) : Call
  data class Ask(val question: String, val options: List<String>) : Call
  data class Finish(val done: Boolean, val summary: String) : Call
  data class Invalid(val error: String) : Call
}

/** The model-facing tools of SPEC §6. */
object Tools {
  private const val INDEX = """"index":{"type":"integer","description":"Element index from the latest screen"}"""
  private const val IRREVERSIBLE = """"irreversible":{"type":"boolean","description":"True if this step can't be undone, such as sending, paying, buying, deleting or posting"}"""
  private const val DIRECTION = """"direction":{"type":"string","enum":["up","down","left","right"]}"""

  private fun spec(name: String, description: String, props: String = "", required: String = "") = ToolSpec(
    name,
    description,
    Json.parseToJsonElement("""{"type":"object","properties":{$props},"required":[$required]}""").jsonObject,
  )

  val specs = listOf(
    spec("open_app", "Open an installed app by the name shown in the launcher, or by its package name.", """"name":{"type":"string"}""", """"name""""),
    spec("open_link", "Open an https, http, tel, sms, mailto or geo link. Prefer this to tapping through menus.", """"url":{"type":"string"}""", """"url""""),
    spec("tap", "Tap an element of the latest screen.", "$INDEX,$IRREVERSIBLE", """"index""""),
    spec(
      "tap_at", "Tap a point in screenshot pixels. Only for custom-drawn screens without usable elements.",
      """"x":{"type":"integer"},"y":{"type":"integer"},$IRREVERSIBLE""", """"x","y"""",
    ),
    spec("long_press", "Long-press an element of the latest screen.", INDEX, """"index""""),
    spec(
      "type_text", "Type text into an editable element, after what it already holds.",
      """$INDEX,"text":{"type":"string"},"press_enter":{"type":"boolean"},$IRREVERSIBLE""", """"index","text"""",
    ),
    spec("scroll", "Scroll an element, or the screen when no index is given.", "$DIRECTION,$INDEX", """"direction""""),
    spec("swipe", "Swipe across the whole screen.", DIRECTION, """"direction""""),
    spec("press", "Press a system button.", """"button":{"type":"string","enum":["back","home","recents","notifications"]}""", """"button""""),
    spec("wait", "Wait for the screen to change.", """"seconds":{"type":"integer","minimum":1,"maximum":5}""", """"seconds""""),
    spec("look", "Attach a screenshot to the next screen."),
    spec(
      "ask_user", "Ask the owner for missing information. Their answer is never approval for a step.",
      """"question":{"type":"string"},"options":{"type":"array","items":{"type":"string"},"maxItems":3}""", """"question"""",
    ),
    spec(
      "finish", "End the task with a short summary for the owner.",
      """"status":{"type":"string","enum":["done","failed"]},"summary":{"type":"string"}""", """"status","summary"""",
    ),
  )

  fun parse(call: ToolCall): Call = try {
    val a = call.args
    val flag = a.flag("irreversible")
    when (call.name) {
      "open_app" -> Call.OpenApp(a.str("name"))
      "open_link" -> Call.Act(Action.OpenLink(a.str("url")), flag)
      "tap" -> Call.Act(Action.Tap(a.int("index")), flag)
      "tap_at" -> Call.Act(Action.TapAt(a.int("x"), a.int("y")), flag)
      "long_press" -> Call.Act(Action.LongPress(a.int("index")), flag)
      "type_text" -> Call.Act(Action.TypeText(a.int("index"), a.str("text"), a.flag("press_enter")), flag)
      "scroll" -> Call.Act(Action.Scroll(a.choice("direction", Direction.entries), a["index"]?.takeUnless { it is JsonNull }?.let { a.int("index") }), flag)
      "swipe" -> Call.Act(Action.Swipe(a.choice("direction", Direction.entries)), flag)
      "press" -> Call.Act(Action.Press(a.choice("button", Button.entries)), flag)
      "wait" -> Call.Act(Action.Wait(a.int("seconds").coerceIn(1, 5)), flag)
      "look" -> Call.Act(Action.Look, flag)
      "ask_user" -> Call.Ask(a.str("question"), (a["options"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content }.take(3))
      "finish" -> Call.Finish(a.choice("status", listOf("done", "failed")) == "done", a.str("summary"))
      else -> Call.Invalid("Unknown tool ${call.name}. Use one of: ${specs.joinToString { it.name }}.")
    }
  } catch (e: IllegalArgumentException) {
    Call.Invalid("Bad arguments for ${call.name}: ${e.message}")
  }

  private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw IllegalArgumentException("$k must be text")

  private fun JsonObject.int(k: String) = (this[k] as? JsonPrimitive)?.intOrNull ?: throw IllegalArgumentException("$k must be a whole number")

  private fun JsonObject.flag(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false

  private fun <T> JsonObject.choice(k: String, options: List<T>): T {
    val s = (this[k] as? JsonPrimitive)?.content
    return options.firstOrNull { it.toString().equals(s, ignoreCase = true) }
      ?: throw IllegalArgumentException("$k must be one of ${options.joinToString { it.toString().lowercase() }}")
  }
}
