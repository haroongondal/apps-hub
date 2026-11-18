package expo.modules.strongroomvault.android

import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.service.autofill.AutofillService
import android.service.autofill.FillResponse
import android.service.autofill.Presentations
import android.view.autofill.AutofillId
import android.widget.RemoteViews
import expo.modules.strongroomvault.core.SmsCodes

/**
 * The armed delayed fill for one form's otp fields (DESIGN §15.3): the service
 * remembers the system's intent sender and the field ids in volatile memory, and
 * the SMS receiver completes the fill the moment a code arrives. A dead process
 * loses the session — the owner refocuses the field instead, and the two-minute
 * cache then covers it.
 */
internal object SmsFill {
  private class Session(val sender: IntentSender, val ids: List<AutofillId>, val armedAt: Long)

  @Volatile private var session: Session? = null

  /** True when the delayed fill is armed: a non-null sender and at least one code field. */
  fun arm(sender: IntentSender?, ids: List<AutofillId>): Boolean {
    val s = sender?.let { Session(it, ids, System.currentTimeMillis()) }
    session = s
    return s != null
  }

  /** Sends [code] as the delayed fill response; true when a fresh session was armed. */
  fun complete(context: Context, code: String): Boolean {
    val s = session ?: return false
    session = null
    if (System.currentTimeMillis() - s.armedAt > SmsCodes.TTL_MS) return false
    return runCatching {
      val response = FillResponse.Builder().addDataset(Datasets.code(s.ids, code, menu(context, code))).build()
      s.sender.sendIntent(context, 0, Intent().putExtra(AutofillService.EXTRA_FILL_RESPONSE, response), null, null)
    }.isSuccess
  }

  // No inline request exists on this path, so the strip is the menu presentation only.
  private fun menu(context: Context, code: String): Presentations {
    val views = RemoteViews(context.packageName, android.R.layout.simple_list_item_1)
    views.setTextViewText(android.R.id.text1, "Fill $code · SMS")
    return Presentations.Builder().setMenuPresentation(views).build()
  }
}
