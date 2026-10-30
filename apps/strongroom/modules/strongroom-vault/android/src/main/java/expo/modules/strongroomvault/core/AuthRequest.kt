package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/** What the unlock screen is asked to do. fill names its entry; pick and cards never do. */
data class AuthRequest(val mode: String, val entryId: String?, val requester: Requester, val label: String) {
  init {
    require(mode in MODES) { "unknown mode" }
    require((entryId != null) == (mode == "fill")) { "only fill names an entry" }
  }

  fun extras(): Map<String, String> = buildMap {
    put(MODE, mode)
    put(REQUESTER, requester.toJson().toString())
    put(LABEL, label)
    entryId?.let { put(ENTRY_ID, it) }
  }

  companion object {
    private const val MODE = "strongroom.mode"
    private const val REQUESTER = "strongroom.requester"
    private const val LABEL = "strongroom.label"
    private const val ENTRY_ID = "strongroom.entryId"
    private val MODES = setOf("fill", "pick", "cards")

    // Catches StackOverflowError too: kotlinx recurses on nesting, and an Error would slip past callers' catch (e: Exception).
    fun parse(get: (String) -> String?): AuthRequest? = try {
      val mode = get(MODE) ?: return null
      val requester = get(REQUESTER) ?: return null
      val label = get(LABEL) ?: return null
      AuthRequest(mode, get(ENTRY_ID), Json.parseToJsonElement(requester).jsonObject.requester(), label)
    } catch (e: IllegalArgumentException) {
      null
    } catch (e: StackOverflowError) {
      null
    }
  }
}

fun shouldServe(pkg: String, ownPkg: String): Boolean = pkg != ownPkg
