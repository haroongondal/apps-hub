package expo.modules.inflowcore.core

interface OwnKeys {
  /** The address each saved key belongs to, one entry per key. */
  fun addresses(): List<String>
  fun deleteAll()
  fun any(): Boolean = addresses().isNotEmpty()
}

// Before the hub, AI was on exactly while a key was saved and aiSince was when the first key went in. The switch keeps that meaning without a key.
class AiSwitch(private val store: ItemStore, private val keys: OwnKeys, private val now: () -> Long) {
  fun on(): Boolean = when (val saved = store.meta(AiMeta.ON)) {
    null -> legacyOn().also { store.setMeta(AiMeta.ON, if (it) "1" else "0") }   // a phone from before the switch: its answer is written down before any key can be deleted
    else -> saved == "1"
  }

  // The old rule counted only the keys saved for the address the model picker had chosen (Google's by default): a Gemini key with the picker moved to Groq meant AI off, and it must not turn on now.
  private fun legacyOn(): Boolean = (store.meta(LEGACY_ADDRESS)?.takeIf { it.isNotBlank() } ?: LEGACY_DEFAULT_ADDRESS) in keys.addresses()

  fun set(on: Boolean) {
    on()
    store.setMeta(AiMeta.ON, if (on) "1" else "0")
    if (on && store.meta(AiMeta.SINCE) == null) store.setMeta(AiMeta.SINCE, now().toString())
  }

  // Saved keys are deleted only once a hub chat returned a real reply on this phone (never on available() alone, never after a hub error): then the owner has a key in the hub.
  // The marker is stored, so the cleanup survives a restart and runs again at every start while the marker exists.
  fun hubAnswered() {
    on()
    if (store.meta(AiMeta.HUB_WORKED) != "1") store.setMeta(AiMeta.HUB_WORKED, "1")
    cleanup()
  }

  fun cleanup() {
    if (store.meta(AiMeta.HUB_WORKED) != "1" || !keys.any()) return
    on()   // writes down a legacy phone's "on" before its keys go
    keys.deleteAll()
  }

  companion object {
    const val LEGACY_ADDRESS = "aiBaseUrl"
    const val LEGACY_DEFAULT_ADDRESS = "https://generativelanguage.googleapis.com/v1beta/openai/"
  }
}
