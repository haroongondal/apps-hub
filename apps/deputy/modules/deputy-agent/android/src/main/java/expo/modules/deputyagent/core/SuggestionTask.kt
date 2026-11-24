package expo.modules.deputyagent.core

/** Which of Inflow's suggestions the owner tapped Run on. */
data class SuggestionRef(val id: Long)

/** The source item Inflow shared. `name` and `text` come from the other person: data, never part of the task. */
data class SuggestionItem(val app: String, val pkg: String, val name: String, val text: String)

sealed interface Begin {
  data class Started(val runId: String) : Begin
  data class Failed(val message: String) : Begin
}

/** Turns a suggestion into a normal run: a code-written task, the item's app plus the owner's look-in apps, the sender and text as untrusted context. */
object SuggestionTask {
  const val CANT_SHARE = "Inflow can't share that message."
  const val CANT_START = "Deputy couldn't start that task."
  private const val NAME_MAX = 40
  private const val SENDER_MAX = 80

  /** Letters, digits, spaces and `. ' -` only, so an app label can't hold markup or a line break. */
  private fun plain(s: String) = s.filter { it.isLetterOrDigit() || it in " .'-" }.take(NAME_MAX).trim()

  /** Only the app label is in the task. The chat name is set by the other person, so it travels with their message as data. */
  const val TAIL = ", open the chat that the notification below came from, find the answer to its latest message from the other apps you may use, and type a reply."

  fun build(app: String) = "In ${plain(app)}$TAIL"

  /** One untrusted entry: who it is from and what they wrote, the name on one line and cut short. */
  internal fun untrustedEntry(name: String, text: String) =
    "From: ${name.replace(Regex("\\s+"), " ").trim().take(SENDER_MAX)}\nMessage: $text"

  fun begin(
    ref: SuggestionRef,
    item: SuggestionItem,
    lookIn: Set<String>,
    start: (task: String, apps: Set<String>, untrusted: List<String>, onEnd: (RunResult) -> Unit) -> String,
  ): Begin {
    if (plain(item.app).isEmpty() || item.name.isBlank() || item.pkg.isBlank() || item.text.isBlank()) return Begin.Failed(CANT_SHARE)
    return try {
      Begin.Started(start(build(item.app), setOf(item.pkg) + lookIn, listOf(untrustedEntry(item.name, item.text))) {})
    } catch (e: Exception) { // any throw (permission, bad state) must come back as a message, never crash the process
      Begin.Failed(e.message ?: CANT_START)
    }
  }
}
