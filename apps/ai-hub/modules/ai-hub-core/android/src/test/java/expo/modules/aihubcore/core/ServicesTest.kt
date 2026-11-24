package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServicesTest {
  @Test fun theKeyPrefixNamesTheService() {
    assertEquals(Service.GROQ, serviceOf("gsk_aaaa1111"))
    assertEquals(Service.GEMINI, serviceOf("AIzabbbb2222"))
    assertEquals(Service.GEMINI, serviceOf("AQ.Ab8RN6bbbb2222"))
    assertNull(serviceOf("sk-ant-nope"))
  }

  @Test fun aLabelShowsTheServiceAndOnlyTheLastFourCharacters() {
    assertEquals("Groq key ending 1a2b", labelOf("gsk_secretsecret1a2b"))
    assertEquals("Gemini key ending 9z8y", labelOf("AIzaSyD-secret9z8y"))
    for (key in listOf("gsk_0123456789abcdef", "AIza0123456789", "AQ.Ab8RN6-0123_9z", "other-key-1234")) {
      assertEquals(4, labelOf(key).substringAfter("key ending ").length)
    }
  }

  @Test fun eachServiceHasItsOpenAiCompatibleBase() {
    assertEquals("https://api.groq.com/openai/v1/", Service.GROQ.baseUrl)
    assertEquals("https://generativelanguage.googleapis.com/v1beta/openai/", Service.GEMINI.baseUrl)
  }

  @Test fun jobDefaults() {
    assertEquals(ModelChoice(Service.GROQ, "openai/gpt-oss-120b"), Job.CHAT.default)
    assertEquals(ModelChoice(Service.GEMINI, "gemini-3.5-flash-lite"), Job.VISION.default)
    assertEquals(ModelChoice(Service.GEMINI, "gemini-embedding-001"), Job.EMBED.default)
    assertEquals(ModelChoice(Service.GROQ, "whisper-large-v3-turbo"), Job.TRANSCRIBE.default)
  }

  @Test fun onlyChatFallsBackToTheOtherService() {
    assertEquals(ModelChoice(Service.GEMINI, "gemini-3.5-flash-lite"), fallbackFor(Job.CHAT, Service.GROQ))
    assertEquals(ModelChoice(Service.GROQ, "openai/gpt-oss-120b"), fallbackFor(Job.CHAT, Service.GEMINI))
    for (job in listOf(Job.VISION, Job.EMBED, Job.TRANSCRIBE)) assertNull(fallbackFor(job, job.default.service))
  }
}
