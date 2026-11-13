package expo.modules.noteboxcore.core

sealed interface OpenPlan {
  object CreateNew : OpenPlan
  object Open : OpenPlan
  data class Fail(val message: String) : OpenPlan
}

const val KEY_LOST_MESSAGE =
  "Notebox can't open your saved history because this phone no longer has its key. The history file is kept, not deleted."

// A database with no key is never replaced: the file stays on disk so a restored key can still open it.
fun openPlan(dbExists: Boolean, wrappedKeyPresent: Boolean): OpenPlan = when {
  dbExists && !wrappedKeyPresent -> OpenPlan.Fail(KEY_LOST_MESSAGE)
  dbExists -> OpenPlan.Open
  else -> OpenPlan.CreateNew
}
