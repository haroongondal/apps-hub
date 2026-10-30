package expo.modules.strongroomvault.android

import android.content.pm.PackageManager
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import expo.modules.strongroomvault.core.AuthRequest
import expo.modules.strongroomvault.core.Browsers
import expo.modules.strongroomvault.core.Entry
import expo.modules.strongroomvault.core.FormDetector
import expo.modules.strongroomvault.core.MatchIndex
import expo.modules.strongroomvault.core.Matching
import expo.modules.strongroomvault.core.PendingSave
import expo.modules.strongroomvault.core.Requester
import expo.modules.strongroomvault.core.Saves
import expo.modules.strongroomvault.core.shouldServe
import expo.modules.strongroomvault.signerSha256
import kotlin.concurrent.thread

internal const val SAVE_FAILED = "Strongroom couldn't keep this password. Unlock Strongroom and save it again."

/** Thin by design: every decision is in core/. Never calls VaultHolder.touch(), so other apps' requests don't keep the vault open. */
class StrongroomAutofillService : AutofillService() {
  override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
    val structure = request.fillContexts.last().structure
    if (!shouldServe(structure.activityComponent.packageName, packageName)) return callback.onSuccess(null)
    // Off the main thread: the vault can be busy for seconds under an Argon2 unlock.
    thread(name = "strongroom-fill") {
      val response = try {
        respond(request, StructureReader.read(structure))
      } catch (e: Exception) {
        null // a missing PSL or anything unexpected from core fails closed: no fill
      }
      if (!cancellationSignal.isCanceled) callback.onSuccess(response)
    }
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    val structure = request.fillContexts.last().structure
    if (!shouldServe(structure.activityComponent.packageName, packageName)) return callback.onSuccess()
    thread(name = "strongroom-save") {
      val kept = try {
        save(StructureReader.read(structure))
      } catch (e: Exception) {
        false
      }
      if (kept) callback.onSuccess() else callback.onFailure(SAVE_FAILED)
    }
  }

  private fun respond(request: FillRequest, read: ReadStructure): FillResponse? {
    val requester = requester(read) ?: return null
    val form = FormDetector.detect(read.nodes)
    if (form.password == null && form.newPassword == null && form.card == null) return null
    if (requester is Requester.Web && !FormDetector.allTargetsInDomain(read.nodes, form, requester.site.host)) return null
    val vault = VaultHolder.get(this)
    if (!vault.isSetUp) return null
    val entries = try {
      vault.takeIf { it.isUnlocked }?.all()
    } catch (e: IllegalStateException) {
      null // locked in between: answer as locked
    }
    val present = Datasets.Presenter(this, request.inlineSuggestionsRequest)
    val response = FillResponse.Builder()
    var any = false

    val logins = FillValues.loginRoles(form).mapValues { read.ids[it.value] }
    if (logins.isNotEmpty()) {
      val host = (requester as? Requester.Web)?.site?.takeIf(Matching::needsHostLabel)?.host
      if (entries != null) {
        for ((_, login) in entries.loginsMatching(requester)) {
          Datasets.filled(logins, login, present.of(login.username.ifEmpty { login.name }, host))?.let { response.addDataset(it); any = true }
        }
      } else {
        for (item in MatchIndex.find(VaultHolder.index(this), requester)) {
          val title = item.username.ifEmpty { item.name }
          val auth = Datasets.authIntent(this, AuthRequest("fill", item.id, requester, title), logins)
          response.addDataset(Datasets.locked(logins, present.of(title, host), auth))
          any = true
        }
      }
      val auth = Datasets.authIntent(this, AuthRequest("pick", null, requester, OTHER_LOGINS), logins)
      response.addDataset(Datasets.locked(logins, present.of(OTHER_LOGINS, null), auth))
      any = true
    }

    val cards = FillValues.cardRoles(form).mapValues { read.ids[it.value] }
    if (cards.isNotEmpty()) {
      if (entries != null) {
        for (row in vault.rows().filter { it.type == "card" }) {
          val auth = Datasets.authIntent(this, AuthRequest("fill", row.id, requester, row.name), cards)
          response.addDataset(Datasets.locked(cards, present.of(row.name, row.subtitle), auth))
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

  private fun save(read: ReadStructure): Boolean {
    val requester = requester(read) ?: return false
    val form = FormDetector.detect(read.nodes)
    if (requester is Requester.Web && !FormDetector.allTargetsInDomain(read.nodes, form, requester.site.host)) return false
    val password = (form.newPassword ?: form.password)?.let { read.values[it] }?.takeIf { it.isNotEmpty() } ?: return false
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
    return applied || VaultHolder.addPending(this, save)
  }

  private fun requester(read: ReadStructure): Requester? =
    Matching.requester(read.pkg, certSha256(read.pkg), read.webDomain, read.webScheme, Browsers.ALLOWLIST)

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

  private fun Map<String, Entry>.loginsMatching(r: Requester): List<Pair<String, Entry.Login>> =
    mapNotNull { (id, e) -> (e as? Entry.Login)?.takeIf { Matching.matches(it, r) }?.let { id to it } }.sortedBy { it.second.name.lowercase() }

  private companion object {
    const val OTHER_LOGINS = "Other logins"
    const val UNLOCK_CARD = "Unlock to fill a card"
  }
}
