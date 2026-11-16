package expo.modules.designmedia.core

import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlin.math.roundToInt
import kotlin.math.sqrt

const val SEARCH_LIMIT = 60
const val SEARCH_FLOOR = 0.25f

private const val DIM = 512
private const val HEADER = 16
private const val RECORD = 24 + DIM
private const val THERMAL_SEVERE = 3
private val MAGIC = "CLIPIDX\u0000".toByteArray(Charsets.ISO_8859_1)

data class PhotoKey(val id: Long, val modified: Long, val size: Long)

class PhotoRow(val key: PhotoKey, val vec: ByteArray)

fun quantize(v: FloatArray): ByteArray {
  val norm = sqrt(v.sumOf { (it * it).toDouble() }).toFloat()
  val scale = if (norm == 0f) 0f else 127f / norm
  return ByteArray(v.size) { (v[it] * scale).roundToInt().coerceIn(-127, 127).toByte() }
}

object PhotoIndexFile {
  const val VERSION = 1

  private fun header(): ByteArray = ByteBuffer.allocate(HEADER).put(MAGIC).putInt(VERSION).putInt(DIM).array()

  private fun encode(rows: List<PhotoRow>): ByteArray {
    val buf = ByteBuffer.allocate(rows.size * RECORD)
    rows.forEach { buf.putLong(it.key.id).putLong(it.key.modified).putLong(it.key.size).put(it.vec) }
    return buf.array()
  }

  // A wrong magic, version or width means "scan again", never an error.
  fun read(f: File): List<PhotoRow> {
    if (!f.exists()) return emptyList()
    val buf = ByteBuffer.wrap(f.readBytes())
    if (buf.remaining() < HEADER) return emptyList()
    val magic = ByteArray(MAGIC.size).also { buf.get(it) }
    if (!magic.contentEquals(MAGIC) || buf.getInt() != VERSION || buf.getInt() != DIM) return emptyList()
    val rows = ArrayList<PhotoRow>(buf.remaining() / RECORD)
    while (buf.remaining() >= RECORD) {
      val key = PhotoKey(buf.getLong(), buf.getLong(), buf.getLong())
      rows.add(PhotoRow(key, ByteArray(DIM).also { buf.get(it) }))
    }
    return rows
  }

  fun append(f: File, rows: List<PhotoRow>) {
    val fresh = !f.exists() || f.length() == 0L
    FileOutputStream(f, true).use { out ->
      if (fresh) out.write(header())
      out.write(encode(rows))
    }
  }

  fun rewrite(f: File, rows: List<PhotoRow>) {
    val tmp = File(f.parentFile, f.name + ".tmp")
    FileOutputStream(tmp).use { it.write(header() + encode(rows)) }
    Files.move(tmp.toPath(), f.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
  }
}

data class IndexDiff(val toEmbed: List<PhotoKey>, val keep: List<PhotoRow>)

fun diff(gallery: List<PhotoKey>, index: List<PhotoRow>): IndexDiff {
  val indexed = index.associateBy { it.key }
  val present = gallery.toSet()
  return IndexDiff(
    toEmbed = gallery.filter { it !in indexed },
    keep = index.filter { it.key in present }.distinctBy { it.key },
  )
}

fun rank(rows: List<PhotoRow>, query: FloatArray, limit: Int, floor: Float): List<Long> {
  val norm = sqrt(query.sumOf { (it * it).toDouble() }).toFloat()
  if (norm == 0f) return emptyList()
  val q = FloatArray(query.size) { query[it] / (norm * 127f) }
  return rows.map { row ->
    var s = 0f
    for (i in q.indices) s += row.vec[i] * q[i]
    row.key.id to s
  }.filter { it.second >= floor }.sortedByDescending { it.second }.take(limit).map { it.first }
}

// Heat is checked first: plugging in doesn't fix it.
fun pauseReason(batteryPct: Int, charging: Boolean, thermalStatus: Int): String? = when {
  thermalStatus >= THERMAL_SEVERE -> "heat"
  batteryPct < 20 && !charging -> "battery"
  else -> null
}

fun shouldPause(batteryPct: Int, charging: Boolean, thermalStatus: Int): Boolean = pauseReason(batteryPct, charging, thermalStatus) != null

fun needsScan(saved: String?, current: String): Boolean = saved != current
