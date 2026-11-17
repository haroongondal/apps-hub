import fs from 'node:fs'
import path from 'node:path'
import * as cheerio from 'cheerio'
import { filterDom } from '../../src/main/lib/TokenOptimizer'
import type { PageSnapshot } from '../../src/main/automation/session'
import type { FixtureRef, PageTransform } from './types'

export interface LoadedPage {
  ref: FixtureRef
  $: cheerio.CheerioAPI
}

export function loadPage(pagesDir: string, ref: FixtureRef): LoadedPage {
  const file = path.join(pagesDir, ref.file)
  const $ = cheerio.load(fs.readFileSync(file, 'utf8'))
  for (const transform of ref.prepare ?? []) applyTransform($, transform)
  return { ref, $ }
}

function applyTransform($: cheerio.CheerioAPI, transform: PageTransform): void {
  if ('remove' in transform) {
    $(transform.remove).remove()
    return
  }
  const target = $(`[data-eval-target="${transform.set}"]`)
  if (target.length === 0) {
    throw new Error(`prepare names marker "${transform.set}", which is not on the page`)
  }
  target.attr(transform.attr, transform.value)
}

// DOM-only snapshots are the production occluded-window path, image cost aside.
export function toSnapshot(page: LoadedPage): PageSnapshot {
  const domError = page.ref.domError ?? null
  const { html, title } = filterDom(page.$.html())
  return {
    url: page.ref.url,
    title: page.ref.title ?? title,
    screenshotBase64: null,
    screenshotError: 'no frame was captured',
    dom: domError ? '' : html,
    domError,
    blockedBy: page.ref.blockedBy ?? null
  }
}
