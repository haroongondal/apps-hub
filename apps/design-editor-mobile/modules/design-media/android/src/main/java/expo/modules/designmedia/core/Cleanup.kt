package expo.modules.designmedia.core

import kotlin.math.sqrt

enum class CleanupKind(val wire: String) { BLURRY("blurry"), COPIES("copies"), LOOKALIKES("lookalikes"), SCREENSHOTS("screenshots"), DARK("dark") }

class CleanupPhoto(
  val id: Long, val vec: ByteArray, val scores: PhotoScores, val bytes: Long, val takenAt: Long,
  val pixels: Long, val relativePath: String?,
)

data class CleanupOptions(val blurThreshold: Double = BLUR_DEFAULT, val lookalikeCosine: Double = LOOKALIKE_DEFAULT)

data class GroupMember(val id: Long, val ticked: Boolean, val best: Boolean)

data class CleanupGroup(val kind: CleanupKind, val key: String, val members: List<GroupMember>, val bytes: Long)

const val BLUR_DEFAULT = 132.1
const val BLUR_MIN = 26.0
const val BLUR_MAX = 298.8
const val LOOKALIKE_DEFAULT = 0.93
const val LOOKALIKE_STRICT = 0.97
const val LOOKALIKE_WINDOW_MS = 600_000L
const val DARK_MEAN = 0.08
const val BLOWN_MEAN = 0.95
const val LOW_SPREAD = 0.08

private val KEEPER = compareByDescending<CleanupPhoto> { it.scores.laplacian }.thenByDescending { it.pixels }
  .thenByDescending { it.bytes }.thenBy { it.takenAt }.thenBy { it.id }
private val NEWEST = compareByDescending<CleanupPhoto> { it.takenAt }.thenBy { it.id }

fun cleanupGroups(photos: List<CleanupPhoto>, dismissed: Set<Pair<CleanupKind, Long>>, opts: CleanupOptions): List<CleanupGroup> {
  fun of(kind: CleanupKind) = photos.filter { (kind to it.id) !in dismissed }
  val blur = opts.blurThreshold.coerceIn(BLUR_MIN, BLUR_MAX)
  val copies = similarGroups(CleanupKind.COPIES, of(CleanupKind.COPIES), ::linkCopies)
  val cosine = if (opts.lookalikeCosine.isNaN()) LOOKALIKE_DEFAULT else opts.lookalikeCosine.coerceIn(LOOKALIKE_DEFAULT, LOOKALIKE_STRICT)
  // A copy the user dismissed has cosine ~1 with its twin; it must not come back pre-ticked as a look-alike.
  val notLookalike = copies.flatMapTo(HashSet()) { g -> g.members.map { it.id } } +
    dismissed.filter { it.first == CleanupKind.COPIES }.map { it.second }
  val lookalikes = similarGroups(CleanupKind.LOOKALIKES, of(CleanupKind.LOOKALIKES).filter { it.id !in notLookalike }) { ps, uf ->
    linkLookalikes(ps, uf, cosine)
  }
  return listOfNotNull(
    single(CleanupKind.BLURRY, of(CleanupKind.BLURRY).filter { it.scores.laplacian < blur }.sortedWith(compareBy({ it.scores.laplacian }, { it.id }))),
  ) + copies + lookalikes + listOfNotNull(
    single(CleanupKind.SCREENSHOTS, of(CleanupKind.SCREENSHOTS).filter { it.relativePath?.contains("Screenshots") == true }.sortedWith(NEWEST)),
    single(CleanupKind.DARK, of(CleanupKind.DARK).filter {
      (it.scores.mean < DARK_MEAN || it.scores.mean > BLOWN_MEAN) && it.scores.spread < LOW_SPREAD
    }.sortedWith(NEWEST)),
  )
}

private fun single(kind: CleanupKind, ps: List<CleanupPhoto>) =
  if (ps.isEmpty()) null else CleanupGroup(kind, kind.wire, ps.map { GroupMember(it.id, ticked = false, best = false) }, ps.sumOf { it.bytes })

private class UnionFind(n: Int) {
  private val parent = IntArray(n) { it }
  fun find(i: Int): Int {
    var x = i
    while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  fun union(a: Int, b: Int) { parent[find(a)] = find(b) }
}

private fun similarGroups(kind: CleanupKind, ps: List<CleanupPhoto>, link: (List<CleanupPhoto>, UnionFind) -> Unit): List<CleanupGroup> {
  val uf = UnionFind(ps.size)
  link(ps, uf)
  return ps.indices.groupBy { uf.find(it) }.values.filter { it.size >= 2 }.map { idx ->
    val group = idx.map { ps[it] }
    val keeper = group.minWith(KEEPER)
    val rest = group.filter { it !== keeper }.sortedWith(NEWEST)
    CleanupGroup(
      kind, "${kind.wire}:${group.minOf { it.id }}",
      listOf(GroupMember(keeper.id, ticked = false, best = true)) + rest.map { GroupMember(it.id, ticked = true, best = false) },
      rest.sumOf { it.bytes },
    )
  }.sortedWith(compareByDescending<CleanupGroup> { it.bytes }.thenBy { it.key })
}

// Multi-index hashing: Hamming <= 4 over 5 disjoint chunks means at least one chunk is equal.
private val CHUNK_SHIFT = intArrayOf(51, 38, 25, 12, 0)

private fun linkCopies(ps: List<CleanupPhoto>, uf: UnionFind) {
  val buckets = HashMap<Int, MutableList<Int>>()
  for ((i, p) in ps.withIndex()) for (c in 0 until 5) {
    val chunk = (p.scores.dhash ushr CHUNK_SHIFT[c]).toInt() and (if (c < 4) 0x1fff else 0xfff)
    buckets.getOrPut(c shl 13 or chunk) { ArrayList(2) }.add(i)
  }
  for (b in buckets.values) for (x in b.indices) for (y in x + 1 until b.size) {
    val i = b[x]
    val j = b[y]
    if (uf.find(i) == uf.find(j)) continue
    val s = ps[i].scores
    val t = ps[j].scores
    if (hamming(s.dhash, t.dhash) <= 4 && aspectClose(s.width, s.height, t.width, t.height)) uf.union(i, j)
  }
}

private fun dot(a: ByteArray, b: ByteArray): Int {
  var s = 0
  for (k in a.indices) s += a[k] * b[k]
  return s
}

private fun linkLookalikes(ps: List<CleanupPhoto>, uf: UnionFind, minCosine: Double) {
  val order = ps.indices.sortedBy { ps[it].takenAt }
  val norm = DoubleArray(ps.size) { sqrt(dot(ps[it].vec, ps[it].vec).toDouble()) }
  for (x in order.indices) {
    val i = order[x]
    if (norm[i] == 0.0) continue
    for (y in x + 1 until order.size) {
      val j = order[y]
      if (ps[j].takenAt - ps[i].takenAt > LOOKALIKE_WINDOW_MS) break
      if (norm[j] == 0.0 || uf.find(i) == uf.find(j)) continue
      if (dot(ps[i].vec, ps[j].vec) / (norm[i] * norm[j]) >= minCosine) uf.union(i, j)
    }
  }
}
