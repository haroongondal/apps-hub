package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The saveFile placement rules from SPEC §14.3: which MediaStore folder each export format uses,
// and when the page's filePath hint lets a re-save replace the previous file instead of colliding.
class SavesTest {
  @Test
  fun imageExportsGoToPictures() {
    assertEquals(Saves.Target(Saves.PIC_FOLDER, "image/png", images = true), Saves.target("png"))
    assertEquals(Saves.Target(Saves.PIC_FOLDER, "image/jpeg", images = true), Saves.target("jpg"))
  }

  @Test
  fun designsAndDocumentsGoToDocuments() {
    assertEquals(Saves.Target(Saves.DOC_FOLDER, "application/json", images = false), Saves.target("json"))
    assertEquals(Saves.Target(Saves.DOC_FOLDER, "application/pdf", images = false), Saves.target("pdf"))
    assertEquals(Saves.Target(Saves.DOC_FOLDER, "image/svg+xml", images = false), Saves.target("svg"))
  }

  @Test
  fun unknownExtensionsLandInDocumentsAsBytes() {
    assertEquals(Saves.Target(Saves.DOC_FOLDER, "application/octet-stream", images = false), Saves.target("webp"))
    assertEquals(Saves.Target(Saves.DOC_FOLDER, "application/octet-stream", images = false), Saves.target(""))
  }

  @Test
  fun caseDoesNotChangeTheTarget() {
    assertEquals(Saves.target("png"), Saves.target("PNG"))
  }

  @Test
  fun pathsInsideOurFoldersReplace() {
    assertTrue(Saves.replaces("Documents/Design Editor/Poster.json", "Poster.json"))
    assertTrue(Saves.replaces("/Documents/Design Editor/Poster.png", "Poster.png"))
    assertTrue(Saves.replaces("Pictures/Design Editor/Poster.png", "Poster.png"))
  }

  @Test
  fun differentNamesDoNotReplace() {
    assertFalse(Saves.replaces("Documents/Design Editor/Poster.json", "Flyer.json"))
    assertFalse(Saves.replaces(null, "Poster.json"))
  }

  @Test
  fun foreignPathsNeverReplace() {
    // a picked-up design outside this app's folders saves as a fresh file
    assertFalse(Saves.replaces(" Holidays poster.json", "Holidays poster.json"))
    assertFalse(Saves.replaces("Download/Poster.json", "Poster.json"))
    // MediaStore may have renamed on a collision; a renamed hint buries into an insert
    assertFalse(Saves.replaces("Documents/Design Editor/Poster (1).json", "Poster.json"))
  }

  @Test
  fun replacedNamesMustMatchExactly() {
    assertFalse(Saves.replaces("Documents/Design Editor/poster.json", "Poster.json"))
  }
}
