package expo.modules.designmedia.core

import java.io.File

// The Gradle test task passes packages/media-core/fixtures as a system property (see build.gradle).
internal fun fixtureText(name: String): String = File(System.getProperty("fixtures.dir"), name).readText()
