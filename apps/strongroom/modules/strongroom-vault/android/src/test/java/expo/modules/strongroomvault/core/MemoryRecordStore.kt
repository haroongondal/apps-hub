package expo.modules.strongroomvault.core

class MemoryRecordStore : RecordStore {
  var headerJson: String? = null
  val records = LinkedHashMap<String, ByteArray>()
  var putAllCalls = 0

  override fun header() = headerJson

  override fun putHeader(json: String) {
    headerJson = json
  }

  override fun all(): Map<String, ByteArray> = LinkedHashMap(records)

  override fun putAll(records: Map<String, ByteArray>) {
    putAllCalls++
    this.records.putAll(records)
  }
}
