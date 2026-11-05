package expo.modules.strongroomvault.core

interface RecordStore {
  fun header(): String?

  fun putHeader(json: String)

  fun all(): Map<String, ByteArray>

  fun putAll(records: Map<String, ByteArray>)
}

class SyncRecord(val id: String, val sealed: ByteArray, val rev: Long, val dirty: Boolean)

data class SyncMeta(val lastRev: Long, val headerRev: Long)

class SyncRow(val id: String, val sealed: ByteArray, val rev: Long)

/** [seen] is the local bytes the merge planned against, null when there was no local row. */
class Adopt(val id: String, val sealed: ByteArray, val rev: Long, val seen: ByteArray?)

data class Rebase(val id: String, val rev: Long)

class PullApplied(
  val header: Header? = null,
  val headerRev: Long,
  val records: List<Adopt>,
  val quarantine: List<SyncRow>,
  val rebase: List<Rebase>,
  val lastRev: Long,
)

// strongroom-core's SyncStore contract (putAll marks dirty; applyPull is one atomic write; markPushed clears dirty only on equal bytes), plus R16: an adopt lands only while the row still holds `seen`, else the edit stays dirty and lastRev stays put so the next sync meets that remote record again.
interface SyncRecordStore : RecordStore {
  fun syncRecords(): List<SyncRecord>

  fun syncMeta(): SyncMeta

  fun applyPull(p: PullApplied)

  fun markPushed(items: List<SyncRow>)

  fun quarantine(): List<Pair<String, Long>>
}
