package expo.modules.strongroomvault.core

import java.security.SecureRandom

/** Passwords for signup forms. No look-alikes (l, I, O, 0, 1) and only symbols most sites accept. */
object PasswordGenerator {
  private val CLASSES = listOf("ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#%-_")
  private val ALL = CLASSES.joinToString("")
  private val random = SecureRandom()

  fun generate(length: Int = 20): String {
    require(length >= CLASSES.size)
    val chars = CLASSES.map { it[random.nextInt(it.length)] } + List(length - CLASSES.size) { ALL[random.nextInt(ALL.length)] }
    return chars.shuffled(random).joinToString("")
  }
}
