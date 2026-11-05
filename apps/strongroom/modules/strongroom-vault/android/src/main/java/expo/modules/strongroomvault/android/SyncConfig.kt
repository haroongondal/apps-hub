package expo.modules.strongroomvault.android

import expo.modules.strongroomvault.core.SyncTransport

internal object SyncConfig {
  // The vault-api Worker, built in (DESIGN §10). Empty until Task 8 deploys it: every sync entry point then reports "off" and opens no connection.
  const val BASE_URL = ""

  fun transport(): SyncTransport? = BASE_URL.takeIf { it.isNotEmpty() }?.let(::HttpSyncTransport)
}
