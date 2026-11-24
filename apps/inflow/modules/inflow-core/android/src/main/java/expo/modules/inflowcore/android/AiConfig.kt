package expo.modules.inflowcore.android

import android.content.Context
import expo.modules.aihubclient.AiHubClient
import expo.modules.inflowcore.core.AiMeta
import expo.modules.inflowcore.core.AiPricing
import expo.modules.inflowcore.core.AiReply
import expo.modules.inflowcore.core.AiSwitch
import expo.modules.inflowcore.core.HubAi
import expo.modules.inflowcore.core.OwnKeys
import expo.modules.inflowcore.core.TextAi
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.runBlocking

/** The keys saved before AI hub became Inflow's only AI. The table stays (old schema); nothing inserts into it. */
class SqlOwnKeys(private val store: SqlItemStore) : OwnKeys {
  override fun addresses(): List<String> = store.query("SELECT base_url FROM ai_keys").use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

  override fun deleteAll() {
    store.run("DELETE FROM ai_keys")
  }
}

/** The owner's AI settings, kept in meta and the ai_* tables of the SQLCipher database (R23). Nothing here logs a prompt or a reply. */
class AiConfig(private val store: SqlItemStore) {
  private val switch = AiSwitch(store, SqlOwnKeys(store), System::currentTimeMillis)

  fun on(): Boolean = switch.on()

  /** Runs at every start: deletes the keys saved before the hub-only change once a hub call has worked on this phone. */
  fun cleanup() = switch.cleanup()

  /** The first time it goes on sets aiSince: only items posted from then on are sent. */
  fun setOn(on: Boolean) = switch.set(on)

  /** null = no limit. */
  fun capUsd(): Double? = when (val v = store.meta(AiMeta.CAP_USD)) {
    null, "" -> DEFAULT_CAP_USD
    "none" -> null
    else -> v.toDoubleOrNull() ?: DEFAULT_CAP_USD
  }

  fun setCap(usd: Double?) = store.setMeta(AiMeta.CAP_USD, usd?.toString() ?: "none")

  fun blocks(): List<String> =
    store.query("SELECT block_key FROM ai_blocks ORDER BY block_key").use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

  fun setBlocked(key: String, blocked: Boolean) {
    if (blocked) store.run("INSERT OR IGNORE INTO ai_blocks(block_key) VALUES (?)", key) else store.run("DELETE FROM ai_blocks WHERE block_key = ?", key)
  }

  /** AI hub for the queue, the categoriser and the reports; null while the owner has AI off. Call it off the main thread (the hub call blocks while it waits). */
  fun provider(ctx: Context, foreground: Boolean = false): TextAi? = if (on()) hub(ctx, foreground) else null

  /** AI hub whether or not AI is on: the Doctor summary is the owner's own tap and has no switch of its own. */
  fun hub(ctx: Context, foreground: Boolean): TextAi {
    val client = AiHubClient(ctx)
    return HubAi({ json -> runBlocking { client.submit(json) } }, foreground, switch::hubAnswered, { UUID.randomUUID().toString() })
  }

  fun today(): String = LocalDate.ofInstant(Instant.now(), ZoneId.systemDefault()).toString()

  /** Today's spending has reached the owner's daily limit. */
  fun capReached(): Boolean = capUsd()?.let { store.spentToday(today()) >= it } == true

  fun spend(reply: AiReply) = store.addSpend(today(), AiPricing.cost(reply))

  fun status(): Map<String, Any?> = mapOf(
    "capUsd" to capUsd(), "spentTodayUsd" to store.spentToday(today()), "queued" to store.queuedCount(),
    "lastRunAt" to store.meta(AiMeta.LAST_RUN_AT)?.toLongOrNull(), "error" to store.meta(AiMeta.ERROR)?.takeIf { it.isNotBlank() }, "on" to on(),
  )

  companion object {
    const val DEFAULT_CAP_USD = 0.50
  }
}
