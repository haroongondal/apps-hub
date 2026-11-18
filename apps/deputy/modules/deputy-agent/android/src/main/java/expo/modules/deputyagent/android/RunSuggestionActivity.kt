package expo.modules.deputyagent.android

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import expo.modules.deputyagent.core.Begin
import expo.modules.deputyagent.core.RunStatus
import expo.modules.deputyagent.core.SuggestionItem
import expo.modules.deputyagent.core.SuggestionRef
import expo.modules.deputyagent.core.SuggestionTask

/**
 * Inflow starts this when the owner taps Run on a reply suggestion. Exported, but only apps signed like Deputy hold the
 * AUTOPILOT permission. It shows nothing: it reads the message from Inflow, hands it to `SuggestionTask.begin`, says
 * in a toast what went wrong, and finishes.
 */
class RunSuggestionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      val id = intent.getLongExtra(EXTRA_ID, -1L)
      if (id >= 0) toast(run(applicationContext, id, intent.getStringArrayExtra(EXTRA_LOOK_IN)?.toSet().orEmpty()))
    } finally {
      finish()
    }
  }

  private fun toast(message: String?) {
    if (message != null) Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
  }

  companion object {
    const val EXTRA_ID = "suggestionId"
    /** Optional: package names of other apps the run may look in, which Inflow keeps as the owner's choice. */
    const val EXTRA_LOOK_IN = "lookIn"
    private const val BASE = "content://com.haroon.inflow.autopilot"

    /** Returns what to tell the owner, or null when the run started. */
    private fun run(context: Context, id: Long, lookIn: Set<String>): String? {
      val item = readItem(context, id) ?: return SuggestionTask.CANT_SHARE
      val result = SuggestionTask.begin(SuggestionRef(id), item, lookIn) { task, apps, untrusted, _ ->
        AgentRuntime.start(context, task, apps, untrusted) { r -> if (r.status == RunStatus.DONE) setState(context, id, "done") }
      }
      return when (result) {
        is Begin.Started -> { setState(context, id, "started"); null }
        is Begin.Failed -> result.message
      }
    }

    /** The suggestion row names its source item; an empty cursor at either step means Inflow refused. */
    private fun readItem(context: Context, id: Long): SuggestionItem? = runCatching {
      val itemId = context.contentResolver.query(Uri.parse("$BASE/suggestions/$id"), null, null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getLong(c.getColumnIndexOrThrow("item_id")) else null
      } ?: return@runCatching null
      context.contentResolver.query(Uri.parse("$BASE/items/$itemId"), null, null, null, null)?.use { c ->
        if (!c.moveToFirst()) return@runCatching null
        fun s(col: String) = c.getString(c.getColumnIndexOrThrow(col)).orEmpty()
        SuggestionItem(s("app"), s("pkg"), s("conversation").ifBlank { s("sender") }, s("text"))
      }
    }.getOrNull()

    private fun setState(context: Context, id: Long, state: String) {
      runCatching { context.contentResolver.update(Uri.parse("$BASE/suggestions/$id"), ContentValues().apply { put("state", state) }, null, null) }
    }
  }
}
