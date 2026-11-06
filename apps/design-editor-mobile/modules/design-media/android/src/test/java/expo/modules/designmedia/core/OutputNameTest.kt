package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Test

// Same cases as packages/media-core/src/__tests__/names.test.ts.
class OutputNameTest {
  private val none: (String) -> Boolean = { false }

  @Test
  fun sizeOutputsAreCompressedMp4() {
    assertEquals("Trip (compressed).mp4", outputName("Trip.mov", "compressed", "mp4", none))
  }

  @Test
  fun aTakenNameGetsTwoThenThree() {
    val taken = setOf("Trip (compressed).mp4", "Trip (compressed) 2.mp4")
    assertEquals("Trip (compressed) 3.mp4", outputName("Trip.mp4", "compressed", "mp4") { it in taken })
  }

  @Test
  fun pathSeparatorsAndControlCharactersAreReplaced() {
    assertEquals("a_b_c_d_ (compressed).mp4", outputName("a/b:c*d?.mp4", "compressed", "mp4", none))
  }

  @Test
  fun aNameWithoutAnExtensionKeepsAllOfIt() {
    assertEquals("Holiday (compressed).mp4", outputName("Holiday", "compressed", "mp4", none))
  }

  @Test
  fun aDotfileKeepsItsDot() {
    assertEquals(".clip (compressed).mp4", outputName(".clip", "compressed", "mp4", none))
  }

  @Test
  fun anEmptyLabelGivesJustTheNameAndTheExtension() {
    assertEquals("Trip.gif", outputName("Trip.mp4", "", "gif", none))
    assertEquals("Trip 2.gif", outputName("Trip.mp4", "", "gif") { it == "Trip.gif" })
  }

  @Test
  fun everyToolHasTheLabelTheMacUses() {
    val plans = decodeSamples()
    val labels = plans.mapValues { outputLabel(it.value) }
    assertEquals("compressed", labels["size"])
    assertEquals("compressed", labels["quality"])
    assertEquals("clip", labels["clipCopy"])
    assertEquals("converted", labels["convertMuted"])
    assertEquals("frame", labels["frame"])
    assertEquals("volume", labels["volumeGain"])
    assertEquals("reversed", labels["reverse"])
    assertEquals("stabilized", labels["stabilize"])
    assertEquals("", labels["gif"])
    assertEquals("Clip (frame).png", outputName("Clip.mp4", labels.getValue("frame"), outputExt(plans.getValue("frame")), none))
  }

  @Test
  fun anAudioLabelNamesTheTrackAndSkipsAnUndefinedLanguage() {
    assertEquals("audio 2 eng", audioLabel(1, "eng"))
    assertEquals("audio 1", audioLabel(0, "und"))
    assertEquals("audio 1", audioLabel(0, null))
    assertEquals("audio 1", audioLabel(0, "not a tag!"))
  }
}
