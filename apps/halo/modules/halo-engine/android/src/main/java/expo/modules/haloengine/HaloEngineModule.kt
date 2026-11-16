package expo.modules.haloengine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HaloEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HaloEngine")

    Function("ping") { "halo" }
  }
}
