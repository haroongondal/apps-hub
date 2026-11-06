package expo.modules.designmedia

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// FR-13: a person never reads engineering words from the native side. Source scan, like ServiceTimeoutTest.
class MessagesTest {
  private val src = File(requireNotNull(System.getProperty("module.src")))
  private fun file(name: String) = src.walkTopDown().single { it.name == name }.readText()

  private val banned = Regex(
    "\\b(codec|encoder|encoders|encoding|bitrate|bit rate|keyframe|mediastore|ffmpeg|transformer|vbr|cbr|spike|phase|exception|stacktrace)\\b",
    RegexOption.IGNORE_CASE,
  )
  private val literal = Regex("\"((?:[^\"\\\\\\n]|\\\\.)*)\"")

  // Strings a person can see: everything in Messages.kt, plus any literal with a space on a line that
  // isn't a log call or an internal exception message, in the files that build notifications, share and fail jobs.
  private fun userVisible(name: String): List<String> = file(name).lines()
    .filterNot { it.contains("Log.") || it.contains("require") || it.trimStart().startsWith("//") }
    .flatMap { line -> literal.findAll(line).map { it.groupValues[1] }.toList() }
    .filter { it.contains(' ') }

  @Test
  fun noSentenceAPersonReadsHasAnEngineeringWord() {
    listOf("Messages.kt", "Notifier.kt", "MediaJobService.kt", "Intents.kt").forEach { name ->
      userVisible(name).forEach { assertFalse("$name: \"$it\"", banned.containsMatchIn(it)) }
    }
    assertTrue(userVisible("Messages.kt").size >= 10)
  }

  @Test
  fun theAuditedSentencesAreTheOnesThatShip() {
    val messages = file("Messages.kt")
    listOf(
      "This video couldn't be made smaller. Try a different setting.",
      "This phone couldn't process that video. Try a different setting.",
      "Couldn't save the result. Check that the phone has free space, then try again.",
      "Something went wrong. Try again.",
      "Video and audio jobs",
      "Working on \$n of \$of",
    ).forEach { assertTrue(it, messages.contains(it)) }
  }

  @Test
  fun theOldSentencesAreGone() {
    val all = src.walkTopDown().filter { it.extension == "kt" }.joinToString("\n") { it.readText() }
    listOf("The encoder produced no output", "The encoder failed", "Couldn't save the output", "Unexpected error.", "Compressing ", "Media jobs", "Only size jobs")
      .forEach { assertFalse(it, all.contains(it)) }
  }

  @Test
  fun aFailureNeverShowsRawExceptionOrEncoderTextOnScreen() {
    val service = file("MediaJobService.kt")
    val calls = Regex("fail\\(([^\\n]*)\\)").findAll(service).map { it.groupValues[1] }.toList()
    assertTrue(calls.size >= 8)
    calls.forEach { assertFalse(it, it.contains("e.message") || it.contains("detail") || it.contains("\$e")) }
    assertEquals(0, Regex("e\\.message").findAll(service).count())
  }
}
