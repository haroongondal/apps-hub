package expo.modules.designmedia.android

import expo.modules.designmedia.core.AudioPlan
import expo.modules.designmedia.core.ClipPlan
import expo.modules.designmedia.core.ComposePlan
import expo.modules.designmedia.core.ConvertPlan
import expo.modules.designmedia.core.FramePlan
import expo.modules.designmedia.core.GifPlan
import expo.modules.designmedia.core.QualityPlan
import expo.modules.designmedia.core.ReversePlan
import expo.modules.designmedia.core.SizePlan
import expo.modules.designmedia.core.StabilizePlan
import expo.modules.designmedia.core.VolumePlan

// SPEC §9.2: which runner does which tool.
object Runners {
  fun start(req: Request, done: (Outcome) -> Unit): Runner {
    val source by lazy { Probe.source(req.context, req.input) }
    return when (val plan = req.plan) {
      is SizePlan -> TransformerRunner.start(req, null, done)
      is QualityPlan -> TransformerRunner.start(req, source, done)
      is ClipPlan -> if (plan.mode == "copy") CopyRunner.start(req, source, done) else TransformerRunner.start(req, source, done)
      is AudioPlan -> if (plan.mode == "aac") TransformerRunner.start(req, null, done) else CopyRunner.start(req, source, done)
      is ConvertPlan -> if (plan.mode == "remux") CopyRunner.start(req, source, done) else TransformerRunner.start(req, source, done)
      is GifPlan -> GifRunner.start(req, source, done)
      is FramePlan -> StillRunner.start(req, source, done)
      is VolumePlan, is ReversePlan, is StabilizePlan -> FfmpegRunner.start(req, source, done)
      is ComposePlan -> TransformerRunner.compose(req, plan, done)
    }
  }
}
