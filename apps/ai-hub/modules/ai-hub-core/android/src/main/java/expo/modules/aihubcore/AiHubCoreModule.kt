package expo.modules.aihubcore

import expo.modules.aihubcore.core.ApiVersion
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AiHubCoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AiHubCore")

    Function("apiVersion") { ApiVersion.CURRENT }
  }
}
