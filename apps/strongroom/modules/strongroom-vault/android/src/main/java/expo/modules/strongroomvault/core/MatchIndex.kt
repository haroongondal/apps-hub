package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

interface Sealer {
  fun seal(plain: ByteArray): ByteArray

  fun open(sealed: ByteArray): ByteArray?
}

data class IndexItem(val id: String, val name: String, val username: String, val sites: List<Site>, val apps: List<AppLink>)

object MatchIndex {
  fun build(entries: Map<String, Entry>): List<IndexItem> =
    entries.mapNotNull { (id, e) -> (e as? Entry.Login)?.let { IndexItem(id, it.name, it.username, it.sites, it.apps) } }
      .sortedWith(compareBy({ it.name.lowercase() }, { it.id }))

  fun encode(items: List<IndexItem>): ByteArray = buildJsonArray {
    for (i in items) {
      addJsonObject {
        put("id", i.id)
        put("name", i.name)
        put("username", i.username)
        putJsonArray("sites") { i.sites.forEach { addSite(it) } }
        putJsonArray("apps") { i.apps.forEach { addAppLink(it) } }
      }
    }
  }.toString().toByteArray(Charsets.UTF_8)

  /** Never throws: a missing, garbled or hostile index is an empty one, and the next unlock rebuilds it. */
  fun decode(bytes: ByteArray?): List<IndexItem> {
    if (bytes == null) return emptyList()
    return try {
      Json.parseToJsonElement(String(bytes, Charsets.UTF_8)).jsonArray.map {
        val o = it.jsonObject
        IndexItem(o.string("id"), o.string("name"), o.string("username"), o.objects("sites").map { s -> s.site() }, o.objects("apps").map { a -> a.appLink() })
      }
    } catch (e: IllegalArgumentException) {
      emptyList()
    } catch (e: StackOverflowError) {
      emptyList()
    }
  }

  fun find(items: List<IndexItem>, r: Requester): List<IndexItem> = items.filter { Matching.matches(it.sites, it.apps, r) }
}
