package expo.modules.deputyagent.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ToolsTest {
  private fun parse(name: String, args: String = "{}") = Tools.parse(ToolCall("c", name, Json.parseToJsonElement(args).jsonObject))

  @Test fun parsesEachActionTool() {
    assertEquals(Call.Act(Action.Tap(9), irreversible = true), parse("tap", """{"index":9,"irreversible":true}"""))
    assertEquals(Call.Act(Action.TapAt(10, 20), irreversible = false), parse("tap_at", """{"x":10,"y":20}"""))
    assertEquals(Call.Act(Action.LongPress(3), false), parse("long_press", """{"index":3}"""))
    assertEquals(Call.Act(Action.TypeText(7, "hi", pressEnter = true), false), parse("type_text", """{"index":7,"text":"hi","press_enter":true}"""))
    assertEquals(Call.Act(Action.Scroll(Direction.DOWN, null), false), parse("scroll", """{"direction":"down"}"""))
    assertEquals(Call.Act(Action.Scroll(Direction.UP, 4), false), parse("scroll", """{"direction":"UP","index":4}"""))
    assertEquals(Call.Act(Action.Scroll(Direction.DOWN, null), false), parse("scroll", """{"direction":"down","index":null}"""))
    assertEquals(Call.Act(Action.Swipe(Direction.LEFT), false), parse("swipe", """{"direction":"left"}"""))
    assertEquals(Call.Act(Action.Press(Button.NOTIFICATIONS), false), parse("press", """{"button":"notifications"}"""))
    assertEquals(Call.Act(Action.Look, false), parse("look"))
    assertEquals(Call.Act(Action.OpenLink("tel:123"), false), parse("open_link", """{"url":"tel:123"}"""))
  }

  @Test fun parsesThePhoneTools() {
    assertEquals(Call.Info, parse("phone_info"))
    assertEquals(Call.FindContact("Sara"), parse("find_contact", """{"name":"Sara"}"""))
    assertEquals(Call.Act(Action.OpenSettings("wifi"), false), parse("open_settings", """{"page":"wifi"}"""))
    assertEquals(Call.Act(Action.SetAlarm(7, 30, "Gym"), false), parse("set_alarm", """{"hour":7,"minute":30,"label":"Gym"}"""))
    assertEquals(Call.Act(Action.SetTimer(600, null), false), parse("set_timer", """{"seconds":600}"""))
    assertTrue(parse("open_settings", """{"page":"accessibility"}""") is Call.Invalid)
    assertTrue("an empty name would list every contact", parse("find_contact", """{"name":" "}""") is Call.Invalid)
    assertTrue(parse("set_alarm", """{"hour":25,"minute":0}""") is Call.Invalid)
  }

  @Test fun openChatTypesTheMessageIntoALinkThatNeverSends() {
    assertEquals(
      Call.Act(Action.OpenLink("whatsapp://send?phone=923001234567&text=Running%2010%20min%20late%20%26%20sorry"), false),
      parse("open_chat", """{"app":"whatsapp","phone":"+92 300 1234567","text":"Running 10 min late & sorry"}"""),
    )
    assertEquals(Call.Act(Action.OpenLink("smsto:+923001234567?body=On%20my%20way"), false), parse("open_chat", """{"app":"sms","phone":"+92 300-1234567","text":"On my way"}"""))
  }

  @Test fun waitIsClampedToOneToFiveSeconds() {
    assertEquals(Call.Act(Action.Wait(5), false), parse("wait", """{"seconds":60}"""))
    assertEquals(Call.Act(Action.Wait(1), false), parse("wait", """{"seconds":0}"""))
  }

  @Test fun parsesTheCallsTheLoopHandlesItself() {
    assertEquals(Call.OpenApp("Clock"), parse("open_app", """{"name":"Clock"}"""))
    // Deputy's own "Label (package)" hint, copied back as the name, opens that package.
    assertEquals(Call.OpenApp("com.google.android.deskclock"), parse("open_app", """{"name":"Clock (com.google.android.deskclock)"}"""))
    assertEquals(Call.OpenApp("Files (Beta)"), parse("open_app", """{"name":"Files (Beta)"}"""))
    assertEquals(Call.Ask("Which Ali?", listOf("Ali K", "Ali R")), parse("ask_user", """{"question":"Which Ali?","options":["Ali K","Ali R"]}"""))
    assertEquals(Call.Finish(done = true, summary = "07:30"), parse("finish", """{"status":"done","summary":"07:30"}"""))
    assertEquals(Call.Finish(done = false, summary = "No alarm app"), parse("finish", """{"status":"failed","summary":"No alarm app"}"""))
  }

  @Test fun badCallsBecomeAnErrorForTheModel() {
    listOf(
      parse("hack_phone"), parse("tap"), parse("tap", """{"index":"nine"}"""), parse("scroll", """{"direction":"sideways"}"""),
      parse("type_text", """{"index":1}"""), parse("finish", """{"status":"maybe","summary":"x"}"""), parse("open_link"),
    ).forEach { assertTrue(it.toString(), it is Call.Invalid) }
  }

  @Test fun everyAdvertisedToolIsUnderstood() = Tools.specs(images = true).forEach {
    val parsed = parse(it.name)
    assertTrue("${it.name}: $parsed", parsed !is Call.Invalid || !(parsed as Call.Invalid).error.startsWith("Unknown tool"))
  }
}
