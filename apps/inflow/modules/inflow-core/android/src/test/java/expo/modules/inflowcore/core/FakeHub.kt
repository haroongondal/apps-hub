package expo.modules.inflowcore.core

import expo.modules.aihubclient.core.AiHubException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// What AI hub sends back and what Inflow sends it, so tests drive the real HubAi.
object FakeHub {
  const val MODEL = "openai/gpt-oss-120b"

  fun reply(text: String, usage: Usage = Usage(10, 0, 5), model: String = MODEL): String =
    """{"text":${Json.encodeToString(kotlinx.serialization.serializer<String>(), text)},"toolCalls":[],"usage":{"inputTokens":${usage.inputTokens},"cachedTokens":${usage.cachedTokens},"outputTokens":${usage.outputTokens}},"model":"$model"}"""

  fun user(requestJson: String): String =
    Json.parseToJsonElement(requestJson).jsonObject["messages"]!!.jsonArray[1].jsonObject["content"]!!.jsonPrimitive.content

  fun fail(kind: String): Nothing = throw AiHubException(kind, "hub said $kind")

  fun ai(foreground: Boolean = false, answered: () -> Unit = {}, hub: (String) -> String) = HubAi(hub, foreground, answered, { "req-1" })
}
