package expo.modules.strongroomvault.android

import expo.modules.strongroomvault.BuildConfig
import expo.modules.strongroomvault.core.SyncTransport

internal object SyncConfig {
  // The vault-api Worker, built in (DESIGN §10). The extension's sync-url.ts holds the same address (its build.test.ts checks they are equal).
  const val BASE_URL = "https://strongroom-vault.haroonmukhtar4.workers.dev"

  // TEST_SYNC_URL is "" in every build but a debug phone proof build (-PstrongroomSyncUrl).
  fun transport(): SyncTransport? = BASE_URL.ifEmpty { BuildConfig.TEST_SYNC_URL }.takeIf { it.isNotEmpty() }?.let(::HttpSyncTransport)
}
