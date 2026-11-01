package expo.modules.strongroomvault.android

import android.app.assist.AssistStructure
import android.content.pm.PackageManager
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillContext
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.util.Log
import expo.modules.strongroomvault.core.AuthRequest
import expo.modules.strongroomvault.core.Browsers
import expo.modules.strongroomvault.core.DetectedForm
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.FormDetector
import expo.modules.strongroomvault.core.MatchIndex
import expo.modules.strongroomvault.core.Matching
import expo.modules.strongroomvault.core.PendingSave
import expo.modules.strongroomvault.core.Requester
import expo.modules.strongroomvault.core.Saves
import expo.modules.strongroomvault.core.answerOnce
import expo.modules.strongroomvault.core.shouldServe
import expo.modules.strongroomvault.signerSha256
import kotlin.concurrent.thread

internal const val SAVE_FAILED = "Strongroom couldn't keep this password. Unlock Strongroom and save it again."
internal const val SAVE_REFUSED = "Strongroom can't save a password from this screen. Add it in Strongroom instead."

/** Thin by design: every decision is in core/. Never calls VaultHolder.touch(), so other apps' requests don't keep the vault open. */
class StrongroomAutofillService : AutofillService() {
  // A cold start's first request needs the suffix list: load it beside that request's Keystore read. A failed load stays quiet here and fails closed at the real lookup.
  override fun onConnected() {
    thread(name = "strongroom-psl") { runCatching { Matching.registrableDomain("example.com") } }
  }

  override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
    // Off the main thread: the vault can be busy for seconds under an Argon2 unlock.
    thread(name = "strongroom-fill") {
      // A missing PSL or anything unexpected from core fails closed: no fill, but still an answer, so the system never waits out its 5 s.
      answerOnce(null, { served(request.fillContexts)?.let { respond(request, StructureReader.read(it)) } }, { failed("fill", it) }, callback::onSuccess)
    }
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    thread(name = "strongroom-save") {
      answerOnce(SAVE_FAILED, { served(request.fillContexts)?.let { save(StructureReader.read(it)) } }, { failed("save", it) }) { failure ->
        if (failure == null) callback.onSuccess() else callback.onFailure(failure)
      }
    }
  }

  private fun served(contexts: List<FillContext>): AssistStructure? =
    contexts.last().structure.takeIf { shouldServe(it.activityComponent.packageName, packageName) }

  // The class name only: a message or stack trace can quote decrypted record text (kotlinx JSON errors include their input).
  private fun failed(what: String, e: Throwable) {
    Log.w("Strongroom", "$what failed: ${e.javaClass.name}")
  }

  private fun respond(request: FillRequest, read: ReadStructure): FillResponse? {
    val form = FormDetector.detect(read.nodes)
    if (form.password == null && form.newPassword == null && form.card == null) return null
    val requester = requester(read, form) ?: return null
    val vault = VaultHolder.get(this)
    if (!vault.isSetUp) return null
    val entries = try {
      vault.takeIf { it.isUnlocked }?.all()
    } catch (e: IllegalStateException) {
      null // locked in between: answer as locked
    }
    val logins = FillValues.loginRoles(form).mapValues { read.ids[it.value] }
    val present = Datasets.Presenter(this, request.inlineSuggestionsRequest, reservePending = logins.isNotEmpty())
    val response = FillResponse.Builder()
    var any = false

    if (logins.isNotEmpty()) {
      val index = if (entries == null) VaultHolder.index(this) else emptyList() // before the first PSL use, so a cold start's Keystore read overlaps the list loading
      val host = (requester as? Requester.Web)?.site?.takeIf(Matching::needsHostLabel)?.host
      if (entries != null) {
        val match = Matching.matcher(requester)
        for (login in entries.values.filterIsInstance<Entry.Login>().filter { match(it.sites, it.apps) }.sortedBy { it.name.lowercase() }) {
          Datasets.filled(logins, login, present.of(login.username.ifEmpty { login.name }, host))?.let { response.addDataset(it); any = true }
        }
      } else {
        for (item in MatchIndex.find(index, requester)) {
          val title = item.username.ifEmpty { item.name }
          val auth = Datasets.authIntent(this, AuthRequest("fill", item.id, requester, title), logins)
          response.addDataset(Datasets.locked(logins, present.of(title, host), auth))
          any = true
        }
      }
      val auth = Datasets.authIntent(this, AuthRequest("pick", null, requester, OTHER_LOGINS), logins)
      response.addDataset(Datasets.locked(logins, present.of(OTHER_LOGINS, null, reserved = true), auth))
      any = true
    }

    val cards = FillValues.cardRoles(form).mapValues { read.ids[it.value] }
    if (cards.isNotEmpty()) {
      if (entries != null) {
        for ((id, card) in entries.mapNotNull { (id, e) -> (e as? Entry.Card)?.let { id to it } }.sortedBy { it.second.name.lowercase() }) {
          val auth = Datasets.authIntent(this, AuthRequest("fill", id, requester, card.name), cards)
          response.addDataset(Datasets.locked(cards, present.of(card.name, "•••• " + card.number.filter(Char::isDigit).takeLast(4)), auth))
          any = true
        }
      } else {
        val auth = Datasets.authIntent(this, AuthRequest("cards", null, requester, UNLOCK_CARD), cards)
        response.addDataset(Datasets.locked(cards, present.of(UNLOCK_CARD, null), auth))
        any = true
      }
    }

    Datasets.saveInfo(form, read.ids)?.let { response.setSaveInfo(it); any = true }
    return if (any) response.build() else null
  }

  /** Null when the password was kept; otherwise the message the save sheet shows. */
  private fun save(read: ReadStructure): String? {
    val form = FormDetector.detect(read.nodes)
    val requester = requester(read, form) ?: return SAVE_REFUSED
    val password = (form.newPassword ?: form.password)?.let { read.values[it] }?.takeIf { it.isNotEmpty() } ?: return SAVE_REFUSED
    val username = form.username?.let { read.values[it] }.orEmpty()
    val save = PendingSave(requester, label(requester), username, password, System.currentTimeMillis())
    val vault = VaultHolder.get(this)
    val applied = try {
      vault.isUnlocked && run {
        Saves.apply(vault, listOf(save))
        VaultHolder.refreshIndex(this)
        true
      }
    } catch (e: Exception) {
      false // locked in between or a write failed: hold it for the next unlock instead
    }
    return if (applied || VaultHolder.addPending(this, save)) null else SAVE_FAILED
  }

  // The web origin comes from the target fields, and a browser's targets must all sit in its domain, so a cross-origin frame gets nothing.
  private fun requester(read: ReadStructure, form: DetectedForm): Requester? {
    val origin = FormDetector.origin(read.nodes, form) ?: return null
    val r = Matching.requester(read.pkg, certSha256(read.pkg), origin.domain, origin.scheme, Browsers.ALLOWLIST) ?: return null
    return r.takeUnless { it is Requester.Web && !FormDetector.allTargetsInDomain(read.nodes, form, it.site.host) }
  }

  private fun certSha256(pkg: String): String? = try {
    packageManager.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())).signerSha256()
  } catch (e: Exception) {
    null // no identity, so nothing matches
  }

  private fun label(r: Requester): String = when (r) {
    is Requester.Web -> Matching.registrableDomain(r.site.host) ?: r.site.host
    is Requester.App -> try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(r.id.pkg, PackageManager.ApplicationInfoFlags.of(0))).toString()
    } catch (e: PackageManager.NameNotFoundException) {
      r.id.pkg
    }
  }

  private companion object {
    const val OTHER_LOGINS = "Other logins"
    const val UNLOCK_CARD = "Unlock to fill a card"
  }
}
