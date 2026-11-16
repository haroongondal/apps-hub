package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IngestMediaTest {
  private val clock = 1_700_000_000_000L
  private val store = MemoryItemStore()
  private val saved = mutableListOf<Triple<Long, RawMedia, Long>>()
  private var sink = MediaSink { id, m, at -> saved += Triple(id, m, at); true }
  private val ingest get() = Ingest(store, "com.haroon.inflow", { clock }, media = sink)

  private val jpeg = RawMedia("image/jpeg", byteArrayOf(1, 2, 3))

  private fun chat(vararg messages: RawMessage, picture: RawMedia? = null) = RawNotification(
    pkg = "com.whatsapp", appLabel = "WhatsApp", key = "k", postTime = clock, ongoing = false, groupSummary = false,
    title = "Sunflower", text = null, bigText = null, subText = null, conversationTitle = null, isGroupConversation = false,
    messages = messages.toList(), textLines = emptyList(), picture = picture,
  )

  @Test fun anItemWithMediaSavesTheFileAndTheText() {
    val m = RawMessage("Sunflower", "Photo", clock + 1, media = jpeg)
    assertEquals(1, ingest.onNotification(chat(m)))
    val item = store.items.values.single()
    assertEquals("Photo", item.capture.text)
    assertEquals(listOf(Triple(item.id, jpeg, clock + 1)), saved)
  }

  @Test fun aBigPictureRidesOnTheNewestMessage() {
    val a = RawMessage("Sunflower", "first", clock + 1)
    val b = RawMessage("Sunflower", "Photo", clock + 2)
    ingest.onNotification(chat(a, b, picture = jpeg))
    assertEquals(store.items.values.single { it.capture.text == "Photo" }.id, saved.single().first)
  }

  @Test fun aFailingSinkNeverLosesTheItem() {
    sink = MediaSink { _, _, _ -> error("disk full") }
    assertEquals(1, ingest.onNotification(chat(RawMessage("Sunflower", "Photo", clock + 1, media = jpeg))))
    assertEquals("Photo", store.items.values.single().capture.text)
  }

  @Test fun aRepostedMessageDoesNotSaveItsMediaAgain() {
    val m = RawMessage("Sunflower", "Photo", clock + 1, media = jpeg)
    ingest.onNotification(chat(m))
    ingest.onNotification(chat(m, RawMessage("Sunflower", "ok", clock + 2)))
    assertEquals(1, saved.size)
  }

  @Test fun noSinkMeansTheTextIsStillSaved() {
    sink = MediaSink { _, _, _ -> false }
    assertEquals(1, ingest.onNotification(chat(RawMessage("Sunflower", "Photo", clock + 1, media = jpeg))))
    assertTrue(store.items.isNotEmpty())
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
