package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

sealed interface SaveAction {
  data class Create(val name: String) : SaveAction

  data class Update(val id: String) : SaveAction
}

data class PendingSave(val requester: Requester, val label: String, val username: String, val password: String, val at: Long) {
  override fun toString() = "PendingSave(requester=$requester, label=$label, username=$username, password=***, at=$at)"
}

object Saves {
  fun decide(index: List<IndexItem>, r: Requester, username: String, label: String): SaveAction =
    MatchIndex.find(index, r).firstOrNull { it.username == username }?.let { SaveAction.Update(it.id) } ?: SaveAction.Create(label)

  fun link(login: Entry.Login, r: Requester): Entry.Login =
    if (Matching.matches(login, r)) {
      login
    } else when (r) {
      // The prompt refuses these too; a caller that skipped it still can't add http beside https or give a package a second certificate.
      is Requester.Web -> if (login.holdsHttpsSiteFor(r.site)) login else login.copy(sites = login.sites + r.site)
      is Requester.App -> if (login.holdsPackageWithOtherCert(r.id)) login else login.copy(apps = login.apps + AppLink(r.id, r.reportedDomain))
    }

  /** Null when the sealer throws; the caller then fails the save request instead of pretending it was kept. */
  fun seal(sealer: Sealer, p: PendingSave): ByteArray? {
    val plain = buildJsonObject {
      put("requester", p.requester.toJson())
      put("label", p.label)
      put("username", p.username)
      put("password", p.password)
      put("at", p.at)
    }.toString().toByteArray(Charsets.UTF_8)
    return try {
      sealer.seal(plain)
    } catch (e: Exception) {
      null
    } finally {
      plain.fill(0)
    }
  }

  fun openAll(sealer: Sealer, sealed: List<ByteArray>): Pair<List<PendingSave>, Int> {
    val opened = sealed.mapNotNull { open(sealer, it) }
    return opened to sealed.size - opened.size
  }

  fun apply(vault: Vault, pending: List<PendingSave>): Int {
    var written = 0
    for (p in pending.sortedBy { it.at }) {
      val stored = vault.all()
      when (val action = decide(MatchIndex.build(stored), p.requester, p.username, p.label)) {
        is SaveAction.Create -> {
          val login = Entry.Login(action.name, p.username, p.password, emptyList(), emptyList(), "", 0)
          vault.put(null, link(login, p.requester))
          written++
        }
        is SaveAction.Update -> {
          val login = stored[action.id] as? Entry.Login ?: continue
          if (login.password == p.password) continue
          vault.put(action.id, login.copy(password = p.password))
          written++
        }
      }
    }
    return written
  }

  // Catches StackOverflowError too: kotlinx recurses on nesting, and an Error would slip past callers' catch (e: Exception).
  private fun open(sealer: Sealer, blob: ByteArray): PendingSave? {
    val plain = try {
      sealer.open(blob)
    } catch (e: Exception) {
      null
    } ?: return null
    return try {
      val o = Json.parseToJsonElement(String(plain, Charsets.UTF_8)).jsonObject
      PendingSave(o.obj("requester").requester(), o.string("label"), o.string("username"), o.string("password"), o.long("at"))
    } catch (e: IllegalArgumentException) {
      null
    } catch (e: StackOverflowError) {
      null
    } finally {
      plain.fill(0)
    }
  }
}
