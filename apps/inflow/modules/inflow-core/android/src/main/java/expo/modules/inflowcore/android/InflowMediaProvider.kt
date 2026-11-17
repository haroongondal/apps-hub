package expo.modules.inflowcore.android

import androidx.core.content.FileProvider

/** A subclass of its own, so it never collides with another FileProvider declaration in the merged manifest. */
class InflowMediaProvider : FileProvider()
