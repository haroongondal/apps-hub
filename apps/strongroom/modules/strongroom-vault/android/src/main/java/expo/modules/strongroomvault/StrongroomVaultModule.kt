package expo.modules.strongroomvault

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StrongroomVaultModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StrongroomVault")

    Function("ping") { "ok" }
  }
}
