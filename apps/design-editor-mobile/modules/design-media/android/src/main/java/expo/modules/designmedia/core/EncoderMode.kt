package expo.modules.designmedia.core

const val CBR = "cbr"
const val VBR = "vbr"
const val FIXED = "fixed"

// Only a re-encode with a bit-rate target has a CBR/VBR choice; every other tool runs once in its one mode.
fun hasBitrateMode(plan: Plan): Boolean = when (plan) {
  is SizePlan, is QualityPlan, is ComposePlan -> true
  is ClipPlan -> plan.mode == "exact"
  is ConvertPlan -> plan.video != null && plan.video.encoder != "copy"
  else -> false
}

// CBR first: on the phone VBR overshot by 45% and CBR landed within 1% (2026-11-02).
fun firstMode(plan: Plan): String = if (hasBitrateMode(plan)) CBR else FIXED
