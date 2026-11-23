package expo.modules.inflowcore.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import expo.modules.inflowcore.core.DoctorRange
import expo.modules.inflowcore.core.PdfLayout
import expo.modules.kotlin.activityresult.AppContextActivityResultContract

// R11: saved only where the owner picks through the system file picker; no share sheet, no FileProvider path, no permission.
object DoctorPdf {
  const val TITLE = "Doctor summary"
  const val FOOTER = "Made with Inflow from data saved on this phone. Not a medical record."
  private const val W = 595   // A4 in points
  private const val H = 842
  private const val M = 56f

  fun fileName(r: DoctorRange) = "doctor-summary-${r.fromDay}-to-${r.toDay}.pdf"

  /** False when the owner's file could not be written; the half-written file is removed. */
  fun save(context: Context, uri: Uri, summary: String, range: DoctorRange): Boolean = try {
    val out = context.contentResolver.openOutputStream(uri) ?: throw IllegalStateException("no stream")
    out.use { write(it, summary, range) }
    true
  } catch (e: Exception) {
    Log.w("DoctorPdf", "save failed: ${e.javaClass.simpleName}")
    runCatching { DocumentsContract.deleteDocument(context.contentResolver, uri) }
    false
  }

  private fun write(out: java.io.OutputStream, summary: String, range: DoctorRange) {
    val body = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 11f }
    val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 18f; typeface = Typeface.DEFAULT_BOLD }
    val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 9f }
    val width = W - 2 * M
    val line = body.fontSpacing
    val room = H - 2 * M - 2 * small.fontSpacing
    val header = title.fontSpacing + 2 * line
    val pages = PdfLayout.pages(PdfLayout.wrap(summary, width, body::measureText), ((room - header) / line).toInt().coerceAtLeast(1), (room / line).toInt().coerceAtLeast(1))
    val doc = PdfDocument()
    try {
      pages.forEachIndexed { i, lines ->
        val page = doc.startPage(PdfDocument.PageInfo.Builder(W, H, i + 1).create())
        val c = page.canvas
        var y = M + body.textSize
        if (i == 0) {
          y = M + title.textSize
          c.drawText(TITLE, M, y, title)
          y += title.fontSpacing
          c.drawText("${range.fromDay} to ${range.toDay}", M, y, body)
          y += 2 * line
        }
        for (l in lines) {
          c.drawText(l, M, y, body)
          y += line
        }
        c.drawText(FOOTER, M, H - M, small)
        val num = "Page ${i + 1} of ${pages.size}"
        c.drawText(num, W - M - small.measureText(num), H - M + small.fontSpacing, small)
        doc.finishPage(page)
      }
      doc.writeTo(out)
    } finally {
      doc.close()
    }
  }

  class CreateContract : AppContextActivityResultContract<String, Uri?> {
    override fun createIntent(context: Context, input: String): Intent =
      Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf").putExtra(Intent.EXTRA_TITLE, input)

    override fun parseResult(input: String, resultCode: Int, intent: Intent?): Uri? = if (resultCode == Activity.RESULT_OK) intent?.data else null
  }
}
