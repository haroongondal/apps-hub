package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Test

class SlideshowTest {
  @Test fun arrivalsCountEachPhotoOnceAndNameTheRepeats() {
    assertEquals("Photos added to the phone during this task, 1 different: a.jpg.\n", Slideshow.arrivals(listOf("a.jpg")))
    assertEquals(
      "Photos added to the phone during this task, 2 different: a (1).jpg, B.jpg. Downloaded again, so not needed: a (2).jpg, b (1).jpg. Don't download a photo twice.\n",
      Slideshow.arrivals(listOf("a (1).jpg", "B.jpg", "a (2).jpg", "b (1).jpg")),
    )
  }

  private fun photo(id: Long, name: String, added: Long = id, w: Int = 3000, h: Int = 4000) = Photo(id, name, added, w, h)

  // Drive saves a second download of the same file as "name (1).jpg" (phone, 2026-11-04).
  private val library = listOf(
    photo(1, "20230604_082213.jpg", added = 100),
    photo(2, "20230604_082213 (1).jpg", added = 200),
    photo(3, "20230604_113105.jpg", added = 150),
    photo(4, "beach.png", added = 50),
  )

  @Test fun aNameMatchesWithOrWithoutItsExtensionAndTheNewestCopyWins() {
    val picked = Slideshow.pick(listOf("20230604_082213", "20230604_113105.jpg"), library)
    assertEquals(listOf(2L, 3L), picked.photos.map { it.id })
    assertEquals(emptyList<String>(), picked.missing)
  }

  @Test fun theDriveNameFindsTheCopyJustDownloadedNotAnOlderFileOfThatName() =
    assertEquals(listOf(2L), Slideshow.pick(listOf("20230604_082213.jpg"), library).photos.map { it.id })

  @Test fun aCopyAskedForByNameIsUsedExactly() =
    assertEquals(listOf(2L), Slideshow.pick(listOf("20230604_082213 (1).jpg"), library + photo(5, "20230604_082213 (2).jpg", added = 300)).photos.map { it.id })

  @Test fun theLookupPrefixDropsTheExtensionAndTheCopySuffix() {
    assertEquals("20230604_082213", Slideshow.prefix(" 20230604_082213 (1).jpg "))
    assertEquals("beach", Slideshow.prefix("beach"))
  }

  @Test fun namesAreMatchedIgnoringCaseAndKeptInTheOrderAsked() =
    assertEquals(listOf(4L, 3L), Slideshow.pick(listOf("BEACH.PNG", "20230604_113105"), library).photos.map { it.id })

  @Test fun aPhotoAskedForTwiceIsUsedOnceAndUnknownNamesAreReported() {
    val picked = Slideshow.pick(listOf("beach", "beach.png", "sunset.jpg"), library)
    assertEquals(listOf(4L), picked.photos.map { it.id })
    assertEquals(listOf("sunset.jpg"), picked.missing)
  }

  @Test fun theFrameFollowsMostPhotosAndATieStaysPortrait() {
    assertEquals(1920 to 1080, Slideshow.frame(listOf(photo(1, "a", w = 4000, h = 3000), photo(2, "b", w = 4000, h = 3000), photo(3, "c"))))
    assertEquals(1080 to 1920, Slideshow.frame(listOf(photo(1, "a", w = 4000, h = 3000), photo(2, "b"))))
    assertEquals("unknown sizes don't vote", 1080 to 1920, Slideshow.frame(listOf(photo(1, "a", w = 0, h = 0))))
  }

  @Test fun eachPhotoFadesInFromBlackAndOutToBlack() {
    val each = 3_000_000L
    assertEquals(0f, Slideshow.fade(0, each), 0.001f)
    assertEquals(0.5f, Slideshow.fade(Slideshow.FADE_US / 2, each), 0.001f)
    assertEquals(1f, Slideshow.fade(each / 2, each), 0.001f)
    assertEquals(0.5f, Slideshow.fade(each - Slideshow.FADE_US / 2, each), 0.001f)
    assertEquals("the second photo starts black again", 0f, Slideshow.fade(each, each), 0.001f)
  }
}
