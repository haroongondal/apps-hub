package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IngestMediaTest {
  private val clock = 1_700_000_000_000L
  private val store = MemoryItemStore()
  private val saved = mutableListOf<Triple<Long, RawMedia, Long>>()
  private val counters = HashMap<String, Long>()
  private var sink = MediaSink { id, m, at -> saved += Triple(id, m, at); true }
  private val ingest get() = Ingest(store, "com.haroon.inflow", { clock }, media = sink, bump = { k, n -> counters.merge(k, n, Long::plus) })

  private val jpeg = RawMedia("image/jpeg", byteArrayOf(1, 2, 3))

  /** A supplier that counts its calls. */
  private class Reads(val media: RawMedia? = RawMedia("image/jpeg", byteArrayOf(1, 2, 3)), val fail: Throwable? = null) : MediaSupplier {
    var calls = 0
    override fun invoke(): RawMedia? {
      calls++
      fail?.let { throw it }
      return media
    }
  }

  private fun chat(vararg messages: RawMessage, picture: MediaSupplier? = null) = RawNotification(
    pkg = "com.whatsapp", appLabel = "WhatsApp", key = "k", postTime = clock, ongoing = false, groupSummary = false,
    title = "Sunflower", text = null, bigText = null, subText = null, conversationTitle = null, isGroupConversation = false,
    messages = messages.toList(), textLines = emptyList(), picture = picture,
  )

  @Test fun anItemWithMediaSavesTheFileAndTheText() {
    val m = RawMessage("Sunflower", "Photo", clock + 1, media = { jpeg })
    assertEquals(1, ingest.onNotification(chat(m)))
    val item = store.items.values.single()
    assertEquals("Photo", item.capture.text)
    assertEquals(listOf(Triple(item.id, jpeg, clock + 1)), saved)
  }

  @Test fun aBigPictureRidesOnTheNewestMessage() {
    val a = RawMessage("Sunflower", "first", clock + 1)
    val b = RawMessage("Sunflower", "Photo", clock + 2)
    ingest.onNotification(chat(a, b, picture = { jpeg }))
    assertEquals(store.items.values.single { it.capture.text == "Photo" }.id, saved.single().first)
  }

  @Test fun aFailingSinkNeverLosesTheItem() {
    sink = MediaSink { _, _, _ -> error("disk full") }
    assertEquals(1, ingest.onNotification(chat(RawMessage("Sunflower", "Photo", clock + 1, media = { jpeg }))))
    assertEquals("Photo", store.items.values.single().capture.text)
  }

  @Test fun aRepostedMessageNeverReadsItsMediaAgain() {
    val reads = Reads()
    val m = RawMessage("Sunflower", "Photo", clock + 1, media = reads)
    ingest.onNotification(chat(m))
    ingest.onNotification(chat(m, RawMessage("Sunflower", "ok", clock + 2)))
    assertEquals(1, reads.calls)
    assertEquals(1, saved.size)
  }

  @Test fun recordOffNeverReadsMedia() {
    store.putAppSetting(AppSetting("com.whatsapp", "WhatsApp", record = false, keepDays = null))
    val reads = Reads()
    assertEquals(0, ingest.onNotification(chat(RawMessage("Sunflower", "Photo", clock + 1, media = reads), picture = reads)))
    assertEquals(0, reads.calls)
    assertTrue(store.items.isEmpty())
  }

  @Test fun anOutOfMemoryInTheSupplierNeverLosesTheItem() {
    val reads = Reads(fail = OutOfMemoryError())
    assertEquals(1, ingest.onNotification(chat(RawMessage("Sunflower", "Photo", clock + 1, media = reads))))
    assertEquals("Photo", store.items.values.single().capture.text)
    assertEquals(1L, counters["mediaUnreadable"])
    assertTrue(saved.isEmpty())
  }

  @Test fun noSinkMeansTheTextIsStillSavedAndNothingIsRead() {
    val reads = Reads()
    val noSink = Ingest(store, "com.haroon.inflow", { clock })
    assertEquals(1, noSink.onNotification(chat(RawMessage("Sunflower", "Photo", clock + 1, media = reads))))
    assertEquals(0, reads.calls)
  }

  @Test fun aSinkThatRefusesStillKeepsTheText() {
    sink = MediaSink { _, _, _ -> false }
    assertEquals(1, ingest.onNotification(chat(RawMessage("Sunflower", "Photo", clock + 1, media = { jpeg }))))
    assertTrue(store.items.isNotEmpty())
  }

  @Test fun aPhotoWithoutACaptionIsKeptWithAnEmptyText() {
    val reads = Reads()
    assertEquals(1, ingest.onNotification(chat(RawMessage("Sunflower", "", clock + 1, media = reads))))
    assertEquals("", store.items.values.single().capture.text)
    assertEquals(1, saved.size)
  }

  @Test fun aBlankMessageWithoutAFileIsStillDropped() {
    assertEquals(0, ingest.onNotification(chat(RawMessage("Sunflower", "  ", clock + 1))))
  }

  @Test fun kindsOfMime() {
    assertEquals("image", MediaKind.of("image/jpeg"))
    assertEquals("sticker", MediaKind.of("image/webp"))
    assertEquals("video", MediaKind.of("video/mp4"))
    assertEquals("audio", MediaKind.of("audio/ogg"))
    assertEquals("document", MediaKind.of("application/pdf"))
    assertEquals("other", MediaKind.of("model/gltf"))
  }
}
