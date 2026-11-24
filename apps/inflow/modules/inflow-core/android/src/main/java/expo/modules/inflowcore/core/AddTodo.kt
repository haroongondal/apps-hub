package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.AppLinkGuard
import expo.modules.inflowcore.applink.AppLinkGuard.ExtraSpec
import expo.modules.inflowcore.applink.AppLinkGuard.ExtraType
import expo.modules.inflowcore.applink.AppLinkGuard.ExtrasCheck

/** A to-do another app asks Inflow to add. The `source` extra is checked but dropped: the screen names the asking app from the verified calling package. */
data class AddTodoRequest(val title: String, val dueAt: Long?, val note: String?)

sealed interface AddTodoParse {
  data class Ok(val request: AddTodoRequest) : AddTodoParse
  data class Rejected(val reason: String) : AddTodoParse
}

/** com.haroon.inflow.action.ADD_TODO (packages/app-link-contract/src/links.ts; fixtures/add-todo-extras.json). Pure Kotlin, so JVM tests run it. */
object AddTodo {
  const val ACTION = "com.haroon.inflow.action.ADD_TODO"

  // Equal to the spec in fixtures/add-todo-extras.json (AddTodoTest checks it).
  val SPEC = mapOf(
    "title" to ExtraSpec(ExtraType.STRING, max = 200, required = true),
    "dueAt" to ExtraSpec(ExtraType.LONG),
    "note" to ExtraSpec(ExtraType.STRING, max = 500),
    "source" to ExtraSpec(ExtraType.STRING, max = 40),
  )

  // ADD_TODO_RESULTS in links.ts; the screen puts them on the result intent as the ActionResult keys.
  const val STATUS_DONE = "done"
  const val CODE_ADDED = "added"
  const val STATUS_CANCELLED = "cancelled"
  const val CODE_CANCELLED = "cancelled"

  /** A title that is only spaces is refused here, so the screen never opens on an empty to-do. */
  fun parse(raw: Map<String, Any?>): AddTodoParse = when (val check = AppLinkGuard.validateExtras(SPEC, raw)) {
    is ExtrasCheck.Rejected -> AddTodoParse.Rejected(check.reason)
    is ExtrasCheck.Ok -> {
      val title = Edits.todoText(check.extras["title"] as String)
      if (title == null) AddTodoParse.Rejected("title is empty")
      else AddTodoParse.Ok(AddTodoRequest(title, check.extras["dueAt"] as Long?, (check.extras["note"] as String?)?.trim()?.takeIf { it.isNotEmpty() }))
    }
  }
}

/**
 * What the Add tap may do. Nothing is written until [unlocked] was called (the caller does that only after Inflow's fingerprint prompt
 * succeeded) and the owner taps Add; one tap writes one row, a second writes none.
 */
class AddTodoFlow(val request: AddTodoRequest, private val save: (text: String, dueAt: Long?) -> Unit) {
  enum class Outcome { ADDED, LOCKED, EMPTY, ALREADY_ADDED, FAILED }

  private var open = false
  private var added = false

  fun unlocked() {
    open = true
  }

  /** [title] is what the owner left in the editable field. */
  fun add(title: String): Outcome {
    if (!open) return Outcome.LOCKED
    if (added) return Outcome.ALREADY_ADDED
    val text = Edits.todoText(title) ?: return Outcome.EMPTY
    return try {
      save(text, request.dueAt)
      added = true
      Outcome.ADDED
    } catch (e: Exception) {
      Outcome.FAILED
    }
  }
}
