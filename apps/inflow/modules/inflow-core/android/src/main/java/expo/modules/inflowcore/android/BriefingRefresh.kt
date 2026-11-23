package expo.modules.inflowcore.android

import android.content.Context
import expo.modules.inflowcore.core.Briefing
import expo.modules.inflowcore.core.BriefingCache
import expo.modules.inflowcore.core.BriefingRefresher
import expo.modules.inflowcore.core.BriefingSnapshot
import java.time.ZoneId
import java.util.concurrent.Executors

/** The one refresher: its own thread (the readers wait on other apps for up to 2 s, which must not hold up the capture thread) and the store's meta as the cache. */
object BriefingRefresh {
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "inflow-briefing").apply { isDaemon = true } }
  @Volatile private var instance: BriefingRefresher? = null

  fun of(context: Context): BriefingRefresher = instance ?: synchronized(this) { instance ?: create(context.applicationContext).also { instance = it } }

  /** App to the foreground, listener connected: rebuild in the background. Nothing runs while sharing is off. */
  fun refresh(context: Context) = of(context).refreshAsync()

  /** Either briefing switch changed: forget what was built (it may hold too much), then rebuild. */
  fun settingChanged(context: Context) = of(context).run {
    clear()
    refreshAsync()
  }

  private fun create(app: Context): BriefingRefresher {
    val store = { StoreHolder.get(app).getOrNull() }
    val cache = object : BriefingCache {
      override fun read(): String? = store()?.meta(BriefingSnapshot.META)
      override fun write(json: String?) {
        val s = store() ?: return
        if (json == null) s.deleteMeta(BriefingSnapshot.META) else s.setMeta(BriefingSnapshot.META, json)
      }
    }
    return BriefingRefresher(
      cache,
      { now -> store()?.let { Briefing.build(StoreBriefingInputs(it, app, ZoneId.systemDefault()), now, ZoneId.systemDefault()) } },
      executor,
      System::currentTimeMillis,
      { Briefing.on(store()?.meta(Briefing.SHARE_META)) },
    )
  }
}
