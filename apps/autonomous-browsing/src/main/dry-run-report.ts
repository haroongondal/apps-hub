import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renderReportMarkdown, summarize, type DryRunReport } from '../shared/dry-run'
import type { DryRunResult } from '../shared/types'

function folderName(report: DryRunReport): string {
  const stamp = new Date(report.startedAt).toISOString().replace(/[:.]/g, '-')
  const slug = report.routineName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${stamp}-${slug || 'routine'}`
}

export async function writeDryRunReport(rootDir: string, report: DryRunReport): Promise<DryRunResult> {
  const dir = path.join(rootDir, folderName(report))
  await mkdir(dir, { recursive: true })

  const frameFiles = new Map<number, string>()
  for (const step of report.steps) {
    if (!step.frame) continue
    const file = `step-${step.index + 1}.jpg`
    await writeFile(path.join(dir, file), Buffer.from(step.frame, 'base64'))
    frameFiles.set(step.index, file)
  }

  const reportPath = path.join(dir, 'report.md')
  await writeFile(reportPath, renderReportMarkdown(report, (index) => frameFiles.get(index) ?? null))
  return { reportPath, summary: summarize(report) }
}
