import * as cheerio from 'cheerio'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertRoutineDefinition } from '../src/shared/routines'
import type { RoutineDefinition } from '../src/shared/types'

const UPDATES_DIR = path.join(__dirname, '..', 'updates')

function loadDefinition(file: string): RoutineDefinition {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(UPDATES_DIR, file), 'utf8'))
  return assertRoutineDefinition((raw as Record<string, unknown>)['definition'])
}

function searchBoxSelectors(definition: RoutineDefinition): string[] {
  const selectors: string[] = []
  for (const step of definition.steps) {
    if ('forSelector' in step && step.forSelector) selectors.push(step.forSelector)
    else if ('selector' in step && step.selector) selectors.push(step.selector)
  }
  return selectors.filter((selector) => selector.includes('[name=q]'))
}

describe('shipped system routines', () => {
  it('every updates/*.json file holds a definition the store will accept', () => {
    const files = fs.readdirSync(UPDATES_DIR).filter((file) => file.endsWith('.json'))

    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(() => loadDefinition(file)).not.toThrow()
  })

  // Google and Bing render the search box as <textarea name="q">, not an input.
  it('search-and-capture matches a textarea-based search box', () => {
    const page = cheerio.load('<form action="/search"><textarea id="APjFqb" name="q"></textarea></form>')
    const selectors = searchBoxSelectors(loadDefinition('search-and-capture.json'))

    expect(selectors.length).toBeGreaterThanOrEqual(2)
    for (const selector of selectors) {
      expect(page(selector).length, `"${selector}" matched nothing`).toBeGreaterThan(0)
    }
  })

  it('search-and-capture still matches a classic input-based search box', () => {
    const page = cheerio.load('<form><input type="search" name="q"></form>')

    for (const selector of searchBoxSelectors(loadDefinition('search-and-capture.json'))) {
      expect(page(selector).length, `"${selector}" matched nothing`).toBeGreaterThan(0)
    }
  })
})
