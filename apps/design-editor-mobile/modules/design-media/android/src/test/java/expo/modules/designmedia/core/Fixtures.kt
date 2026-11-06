package expo.modules.designmedia.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

// The Gradle test task passes packages/media-core/fixtures as a system property (see build.gradle).
internal fun fixtureText(name: String): String = File(System.getProperty("fixtures.dir"), name).readText()

// One plan per tool and mode, as the media-core planners produce them (fixtures/plan-examples.json).
internal fun decodeSamples(): Map<String, Plan> =
  Json.parseToJsonElement(fixtureText("plan-examples.json")).jsonObject.getValue("plans").jsonObject
    .mapValues { (_, v) -> decodePlan(v.jsonObject) }
