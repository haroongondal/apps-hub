package expo.modules.strongroomvault.core

interface RecordStore {
  fun header(): String?

  fun putHeader(json: String)

  fun all(): Map<String, ByteArray>

  fun putAll(records: Map<String, ByteArray>)
}
