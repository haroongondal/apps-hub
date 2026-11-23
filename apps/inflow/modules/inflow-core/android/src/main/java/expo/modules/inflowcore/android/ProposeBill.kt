package expo.modules.inflowcore.android

import android.content.Context
import android.content.Intent
import expo.modules.inflowcore.applink.SiblingPackages
import expo.modules.inflowcore.core.ProposeReply
import expo.modules.inflowcore.core.ProposeTaskExtras
import expo.modules.inflowcore.core.ProposeToDeputy
import expo.modules.inflowcore.core.SuggestionKind
import expo.modules.inflowcore.core.SuggestionState
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.time.ZoneId

/** The input Expo's launcher needs (it must be Serializable); the Intent is rebuilt from it by the same function the trust check uses. */
class ProposeStart(private val extras: HashMap<String, Any>) : java.io.Serializable {
  fun intent(): Intent {
    val intent = Intent(ProposeToDeputy.ACTION).setPackage(SiblingPackages.DEPUTY)
    for ((k, v) in extras) if (v is Long) intent.putExtra(k, v) else intent.putExtra(k, v as String)
    return intent
  }
}

object ProposeBill {
  /** Null when the bill is gone or no longer a waiting bill. */
  fun start(items: SqlItemStore, suggestions: SqlSuggestionStore, id: Long, now: Long, zone: ZoneId): ProposeStart? {
    val s = suggestions.get(id)?.takeIf { it.kind == SuggestionKind.BILL && it.state == SuggestionState.WAITING && it.expiresAt > now } ?: return null
    val extras = ProposeTaskExtras.forBill(s.id, items.billPayee(s.itemId), s.dueAt, zone) ?: return null
    return ProposeStart(HashMap(extras))
  }

  class Contract : AppContextActivityResultContract<ProposeStart, ProposeReply> {
    override fun createIntent(context: Context, input: ProposeStart): Intent = input.intent()

    override fun parseResult(input: ProposeStart, resultCode: Int, intent: Intent?): ProposeReply =
      runCatching { ProposeReply(resultCode, intent?.getStringExtra("status"), intent?.getStringExtra("code")) }.getOrDefault(ProposeReply(resultCode, null, null))
  }
}
