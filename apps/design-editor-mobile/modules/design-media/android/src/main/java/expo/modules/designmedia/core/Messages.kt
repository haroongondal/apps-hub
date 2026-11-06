package expo.modules.designmedia.core

// Every sentence a person can read from the native side. MessagesTest bans engineering words here.
object Messages {
  const val CHANNEL = "Video and audio jobs"
  const val STARTING = "Starting"
  const val CANCEL = "Cancel"
  const val NOTHING_MADE = "This video couldn't be made smaller. Try a different setting."
  const val COULDNT_PROCESS = "This phone couldn't process that video. Try a different setting."
  const val COULDNT_SAVE = "Couldn't save the result. Check that the phone has free space, then try again."
  const val WENT_WRONG = "Something went wrong. Try again."
  const val TOO_SMALL = "This video can't get that small. Pick a bigger size."
  const val COULDNT_OPEN = "Couldn't open that file. Pick it again."
  const val NO_APP = "No app on this phone can open that file."

  fun working(n: Int, of: Int) = "Working on $n of $of"

  fun noRoom(megabytes: Long) = "Not enough free space: needs $megabytes MB."

  fun overTarget(megabytes: Long) = "Couldn't fit under $megabytes MB."
}
