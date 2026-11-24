package expo.modules.storeinstaller

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull

object Deadline {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  // A binder call cannot be interrupted, so the blocking work runs detached and a late result is dropped.
  suspend fun <T> within(ms: Long, block: () -> T): T? {
    val work = scope.async { runCatching(block).getOrNull() }
    return withTimeoutOrNull(ms) { work.await() }
  }
}
