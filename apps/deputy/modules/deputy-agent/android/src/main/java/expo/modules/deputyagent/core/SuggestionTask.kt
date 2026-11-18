package expo.modules.deputyagent.core

/** Which of Inflow's suggestions the owner tapped Run on. */
data class SuggestionRef(val id: Long)

/** The source item Inflow shared. `text` is the other person's words: data, never part of the task. */
data class SuggestionItem(val app: String, val pkg: String, val name: String, val text: String)

sealed interface Begin {
  data class Started(val runId: String) : Begin
  data class Failed(val message: String) : Begin
}

/** Turns a suggestion into a normal run: a code-written task, the item's app plus the owner's look-in apps, the text as untrusted context. */
object SuggestionTask {
  const val CANT_SHARE = "Inflow can't share that message."
  private const val NAME_MAX = 40

  /** Letters, digits, spaces and `. ' -` only, so a sender or app name can't hold markup or a line break. */
  private fun plain(s: String) = s.filter { it.isLetterOrDigit() || it in " .'-" }.take(NAME_MAX).trim()

  fun build(app: String, name: String) =
    "In ${plain(app)}, open the chat with ${plain(name)}, find the answer to their latest message from the other apps you may use, and type a reply."

  fun begin(
    ref: SuggestionRef,
    item: SuggestionItem,
    lookIn: Set<String>,
    start: (task: String, apps: Set<String>, untrusted: List<String>, onEnd: (RunResult) -> Unit) -> String,
  ): Begin {
    if (plain(item.app).isEmpty() || plain(item.name).isEmpty() || item.pkg.isBlank() || item.text.isBlank()) return Begin.Failed(CANT_SHARE)
    return try {
      Begin.Started(start(build(item.app, item.name), setOf(item.pkg) + lookIn, listOf(item.text)) {})
    } catch (e: IllegalStateException) {
      Begin.Failed(e.message ?: CANT_SHARE)
    }
  }
}
