import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'

// Mirrors queryAll/rank/best in extension/content.js — keep the two in step.
const HAS_TEXT = /:has-text\((?:"([^"]*)"|'([^']*)')\)\s*$/

export interface Resolution {
  invalid: boolean
  count: number
  winner: Element | null
  marker: string | null
  actionable: boolean
  problem: string | null
}

export function accessibleText($: cheerio.CheerioAPI, el: Element): string {
  const $el = $(el)
  const labelledBy = ($el.attr('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => $(`#${id}`).text())
    .join(' ')
  const parts = [
    $el.text(),
    $el.attr('aria-label'),
    $el.attr('title'),
    $el.attr('placeholder'),
    $el.attr('alt'),
    $el.attr('name'),
    labelledBy,
    $el.attr('value')
  ]
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

function isHidden($: cheerio.CheerioAPI, el: Element): boolean {
  const $el = $(el)
  if ($el.attr('hidden') !== undefined) return true
  if ($el.attr('aria-hidden') === 'true') return true
  const style = $el.attr('style')
  if (style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true
  return el.name === 'input' && $el.attr('type')?.toLowerCase() === 'hidden'
}

function isDisabled($: cheerio.CheerioAPI, el: Element): boolean {
  const $el = $(el)
  if ($el.attr('disabled') !== undefined) return true
  return $el.closest('[aria-disabled="true"], fieldset[disabled]').length > 0
}

function rank($: cheerio.CheerioAPI, el: Element): number {
  if (isHidden($, el)) return 1
  if (isDisabled($, el)) return 2
  return 4
}

export function resolveSelector($: cheerio.CheerioAPI, selector: string): Resolution {
  const textMatch = HAS_TEXT.exec(selector)
  const base = textMatch ? selector.slice(0, textMatch.index) || '*' : selector
  const wanted = textMatch ? (textMatch[1] ?? textMatch[2] ?? '').trim().toLowerCase() : null

  let found: Element[]
  try {
    found = $(base).toArray().filter((node): node is Element => node.type === 'tag')
  } catch {
    return {
      invalid: true,
      count: 0,
      winner: null,
      marker: null,
      actionable: false,
      problem: `"${selector}" is not a valid selector`
    }
  }

  const candidates =
    wanted === null ? found : found.filter(el => accessibleText($, el).includes(wanted))

  let winner: Element | null = null
  let winningRank = 0
  for (const el of candidates) {
    const score = rank($, el)
    if (score <= winningRank) continue
    winner = el
    winningRank = score
  }

  if (!winner) {
    return {
      invalid: false,
      count: 0,
      winner: null,
      marker: null,
      actionable: false,
      problem: 'nothing on this page matches it'
    }
  }

  const problem =
    winningRank === 1
      ? 'the best match is not visible'
      : winningRank === 2
        ? 'the best match is disabled'
        : null
  return {
    invalid: false,
    count: candidates.length,
    winner,
    marker: $(winner).attr('data-eval-target') ?? null,
    actionable: winningRank === 4,
    problem
  }
}
