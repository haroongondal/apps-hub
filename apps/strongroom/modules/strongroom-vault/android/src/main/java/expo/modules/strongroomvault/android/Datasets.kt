package expo.modules.strongroomvault.android

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.net.Uri
import android.os.Bundle
import android.service.autofill.Dataset
import android.service.autofill.Field
import android.service.autofill.InlinePresentation
import android.service.autofill.Presentations
import android.service.autofill.SaveInfo
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.view.inputmethod.InlineSuggestionsRequest
import android.widget.RemoteViews
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import expo.modules.strongroomvault.core.AuthRequest
import expo.modules.strongroomvault.core.DetectedForm
import expo.modules.strongroomvault.core.Entry
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

internal object FillValues {
  const val USERNAME = "username"
  const val PASSWORD = "password"
  const val NUMBER = "number"
  const val HOLDER = "holder"
  const val EXP_MONTH = "expMonth"
  const val EXP_YEAR = "expYear"
  const val EXP_DATE = "expDate"
  const val CVC = "cvc"
  val ROLES = listOf(USERNAME, PASSWORD, NUMBER, HOLDER, EXP_MONTH, EXP_YEAR, EXP_DATE, CVC)

  fun of(e: Entry): Map<String, String> = when (e) {
    is Entry.Login -> mapOf(USERNAME to e.username, PASSWORD to e.password)
    is Entry.Card -> buildMap {
      put(NUMBER, e.number)
      put(HOLDER, e.holder)
      put(CVC, e.cvc)
      e.expMonth?.let { put(EXP_MONTH, "%02d".format(it)) }
      e.expYear?.let { put(EXP_YEAR, it.toString()) }
      if (e.expMonth != null && e.expYear != null) put(EXP_DATE, "%02d/%02d".format(e.expMonth, e.expYear % 100))
    }
    else -> emptyMap()
  }.filterValues { it.isNotEmpty() }

  fun loginRoles(form: DetectedForm): Map<String, Int> =
    listOfNotNull(form.username?.let { USERNAME to it }, form.password?.let { PASSWORD to it }).toMap()

  fun cardRoles(form: DetectedForm): Map<String, Int> {
    val c = form.card ?: return emptyMap()
    return listOf(NUMBER to c.number, HOLDER to c.holder, EXP_MONTH to c.expMonth, EXP_YEAR to c.expYear, EXP_DATE to c.expDate, CVC to c.cvc)
      .mapNotNull { (role, i) -> i?.let { role to it } }.toMap()
  }
}

internal object Datasets {
  private const val TARGETS = "strongroom.targets"
  private val requestCodes = AtomicInteger()

  fun filled(targets: Map<String, AutofillId>, e: Entry, presentations: Presentations? = null): Dataset? {
    val values = FillValues.of(e).filterKeys { it in targets }
    if (values.isEmpty()) return null
    val b = presentations?.let { Dataset.Builder(it) } ?: Dataset.Builder()
    for ((role, v) in values) b.setField(targets.getValue(role), Field.Builder().setValue(AutofillValue.forText(v)).build())
    return b.build()
  }

  fun locked(targets: Map<String, AutofillId>, presentations: Presentations, auth: IntentSender): Dataset {
    val b = Dataset.Builder(presentations).setAuthentication(auth)
    for (id in targets.values) b.setField(id, Field.Builder().build())
    return b.build()
  }

  // Immutable, so Android's fill-in extras (structure, client state) never reach UnlockActivity; the URI keeps each one distinct.
  fun authIntent(context: Context, req: AuthRequest, targets: Map<String, AutofillId>): IntentSender {
    val intent = Intent(context, UnlockActivity::class.java)
      .setData(Uri.parse("strongroom://auth/" + UUID.randomUUID()))
      .putExtra(TARGETS, Bundle().apply { targets.forEach { (role, id) -> putParcelable(role, id) } })
    req.extras().forEach { (k, v) -> intent.putExtra(k, v) }
    return PendingIntent.getActivity(context, requestCodes.incrementAndGet(), intent, PendingIntent.FLAG_IMMUTABLE).intentSender
  }

  fun targets(intent: Intent): Map<String, AutofillId> {
    val b = intent.getBundleExtra(TARGETS) ?: return emptyMap()
    return FillValues.ROLES.mapNotNull { role -> b.getParcelable(role, AutofillId::class.java)?.let { role to it } }.toMap()
  }

  fun saveInfo(form: DetectedForm, ids: List<AutofillId>): SaveInfo? {
    val password = (form.newPassword ?: form.password)?.let(ids::get) ?: return null
    val username = form.username?.let(ids::get)
    val type = SaveInfo.SAVE_DATA_TYPE_PASSWORD or (if (username != null) SaveInfo.SAVE_DATA_TYPE_USERNAME else 0)
    return SaveInfo.Builder(type, arrayOf(password))
      .apply { if (username != null) setOptionalIds(arrayOf(username)) }
      .setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)
      .build()
  }

  class Presenter(private val context: Context, private val inline: InlineSuggestionsRequest?) {
    private var shown = 0
    private val attribution by lazy {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
      PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE)
    }

    fun of(title: String, subtitle: String?): Presentations {
      val menu = RemoteViews(context.packageName, android.R.layout.simple_list_item_1)
      menu.setTextViewText(android.R.id.text1, listOfNotNull(title, subtitle).joinToString(" · "))
      val b = Presentations.Builder().setMenuPresentation(menu)
      val specs = inline?.inlinePresentationSpecs.orEmpty()
      // shortcut: past maxSuggestionCount a dataset shows only in the dropdown; reserve a slot for "Other logins" if owners miss it.
      if (inline != null && specs.isNotEmpty() && shown < inline.maxSuggestionCount) {
        val spec = specs[minOf(shown, specs.size - 1)]
        if (UiVersions.INLINE_UI_VERSION_1 in UiVersions.getVersions(spec.style)) {
          val content = InlineSuggestionUi.newContentBuilder(attribution).setTitle(title).apply { subtitle?.let(::setSubtitle) }.build()
          b.setInlinePresentation(InlinePresentation(content.slice, spec, false))
        }
      }
      shown++
      return b.build()
    }
  }
}
