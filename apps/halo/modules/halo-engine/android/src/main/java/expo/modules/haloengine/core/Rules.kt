package expo.modules.haloengine.core

/** What the phone is doing right now, as far as the hide rules care. RuleInputs keeps it current. */
class RuleState(
  var foregroundPkg: String?,
  var fullscreen: Boolean,
  var landscape: Boolean,
  var inCall: Boolean,
  var batterySaver: Boolean,
  var pocket: Boolean,
)

/** The lights hide while any switched-on rule matches; they come back as soon as none does. */
object Rules {
  fun hidden(s: SettingsRules, st: RuleState): Boolean =
    (st.foregroundPkg != null && st.foregroundPkg in s.apps) ||
      (s.fullscreen && st.fullscreen) ||
      (s.landscape && st.landscape) ||
      (s.calls && st.inCall) ||
      (s.batterySaver && st.batterySaver) ||
      (s.pocket && st.pocket)
}
