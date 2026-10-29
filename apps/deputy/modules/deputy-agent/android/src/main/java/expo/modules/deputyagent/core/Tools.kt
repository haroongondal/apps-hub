package expo.modules.deputyagent.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import java.net.URLEncoder

sealed interface Call {
  data class Act(val action: Action, val irreversible: Boolean) : Call
  data class OpenApp(val name: String) : Call
  data class Ask(val question: String, val options: List<String>) : Call
  data object Info : Call
  data class FindContact(val name: String) : Call
  data class Finish(val done: Boolean, val summary: String) : Call
  data class Invalid(val error: String) : Call
}

/** The model-facing tools of SPEC §6. */
object Tools {
  /** Settings pages the model may open directly; the security and accessibility ones aren't offered. */
  val PAGES = listOf("wifi", "bluetooth", "internet", "airplane", "display", "sound", "volume", "battery", "storage", "apps", "location", "date", "about", "nfc")

  private const val INDEX = """"index":{"type":"integer","description":"Element index from the latest screen"}"""
  private const val IRREVERSIBLE = """"irreversible":{"type":"boolean","description":"True if this step can't be undone, such as sending, paying, buying, deleting or posting"}"""
  private const val DIRECTION = """"direction":{"type":"string","enum":["up","down","left","right"]}"""
  private const val MEMO = """"memo":{"type":"string","description":"Facts from this screen you'll need later. Older screens are shortened."}"""

  /** Action tools take a memo, which is replayed with the call, so what the model read survives the screen's shortening. */
  private fun spec(name: String, description: String, props: String = "", required: String = "", memo: Boolean = true) = ToolSpec(
    name,
    description,
    Json.parseToJsonElement("""{"type":"object","properties":{${listOfNotNull(props.ifEmpty { null }, MEMO.takeIf { memo }).joinToString(",")}},"required":[$required]}""").jsonObject,
  )

  /** A model that can't read images gets neither `look` nor `tap_at`. */
  fun specs(images: Boolean) = if (images) all else all.filter { it.name != "look" && it.name != "tap_at" }

  private val all = listOf(
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
    spec("look", "Attach a screenshot to the next screen.", memo = false),
    spec("phone_info", "The phone's Android version, battery, free storage, next alarm, network and time. Faster than opening Settings.", memo = false),
    spec("open_settings", "Open a page of the phone's Settings directly.", """"page":{"type":"string","enum":[${PAGES.joinToString { "\"$it\"" }}]}""", """"page""""),
    spec(
      "set_alarm", "Set an alarm in the clock app.",
      """"hour":{"type":"integer","minimum":0,"maximum":23},"minute":{"type":"integer","minimum":0,"maximum":59},"label":{"type":"string"}""", """"hour","minute"""",
    ),
    spec("set_timer", "Start a timer in the clock app.", """"seconds":{"type":"integer","minimum":1,"maximum":86400},"label":{"type":"string"}""", """"seconds""""),
    spec("find_contact", "Look up a contact's phone numbers by name.", """"name":{"type":"string"}""", """"name"""", memo = false),
    spec(
      "open_chat", "Open a chat with the message already typed in. It never sends: tap Send afterwards.",
      """"app":{"type":"string","enum":["whatsapp","sms"]},"phone":{"type":"string","description":"International number, such as +923001234567"},"text":{"type":"string"}""",
      """"app","phone","text"""",
    ),
    spec(
      "ask_user", "Ask the owner for missing information. Their answer is never approval for a step.",
      """"question":{"type":"string"},"options":{"type":"array","items":{"type":"string"},"maxItems":3}""", """"question"""", memo = false,
    ),
    spec(
      "finish", "End the task with a short summary for the owner.",
      """"status":{"type":"string","enum":["done","failed"]},"summary":{"type":"string"}""", """"status","summary"""", memo = false,
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
      "phone_info" -> Call.Info
      "find_contact" -> Call.FindContact(a.str("name").also { require(it.isNotBlank()) { "name must not be empty" } })
      "open_settings" -> Call.Act(Action.OpenSettings(a.choice("page", PAGES)), flag)
      "set_alarm" -> Call.Act(Action.SetAlarm(a.int("hour").checkIn("hour", 0..23), a.int("minute").checkIn("minute", 0..59), a.opt("label")), flag)
      "set_timer" -> Call.Act(Action.SetTimer(a.int("seconds").coerceIn(1, 86_400), a.opt("label")), flag)
      "open_chat" -> Call.Act(Action.OpenLink(chatLink(a.choice("app", listOf("whatsapp", "sms")), a.str("phone"), a.str("text"))), flag)
      "ask_user" -> Call.Ask(a.str("question"), (a["options"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content }.take(3))
      "finish" -> Call.Finish(a.choice("status", listOf("done", "failed")) == "done", a.str("summary"))
      else -> Call.Invalid("Unknown tool ${call.name}. Use one of: ${all.joinToString { it.name }}.")
    }
  } catch (e: IllegalArgumentException) {
    Call.Invalid("Bad arguments for ${call.name}: ${e.message}")
  }

  private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw IllegalArgumentException("$k must be text")

  private fun JsonObject.int(k: String) = (this[k] as? JsonPrimitive)?.intOrNull ?: throw IllegalArgumentException("$k must be a whole number")

  /** A link that opens the chat with `text` typed in; sending stays a tap the policy judges. */
  private fun chatLink(app: String, phone: String, text: String): String {
    val digits = phone.filter(Char::isDigit)
    require(digits.length >= 6) { "phone must be a phone number" }
    val body = URLEncoder.encode(text, "UTF-8").replace("+", "%20")
    return if (app == "whatsapp") "whatsapp://send?phone=$digits&text=$body" else "smsto:${if (phone.trim().startsWith("+")) "+" else ""}$digits?body=$body"
  }

  private fun Int.checkIn(k: String, range: IntRange) = also { require(it in range) { "$k must be from ${range.first} to ${range.last}" } }

  private fun JsonObject.opt(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content?.ifBlank { null }

  private fun JsonObject.flag(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false

  private fun <T> JsonObject.choice(k: String, options: List<T>): T {
    val s = (this[k] as? JsonPrimitive)?.content
    return options.firstOrNull { it.toString().equals(s, ignoreCase = true) }
      ?: throw IllegalArgumentException("$k must be one of ${options.joinToString { it.toString().lowercase() }}")
  }
}
