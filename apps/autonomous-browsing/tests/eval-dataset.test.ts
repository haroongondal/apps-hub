import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDataset } from '../evals/harness/dataset'

describe('the shipped eval dataset', () => {
  it('loads, cross-checked against its fixture pages', () => {
    const dataset = loadDataset(path.resolve('evals'))
    expect(dataset.decisions.length).toBeGreaterThanOrEqual(10)
    expect(dataset.repairs.length).toBeGreaterThanOrEqual(5)
    expect(dataset.goals.length).toBeGreaterThanOrEqual(3)
  })
})

describe('dataset validation', () => {
  it('rejects markers, pages and regexes that do not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-'))
    fs.mkdirSync(path.join(dir, 'cases'))
    fs.mkdirSync(path.join(dir, 'pages'))
    fs.writeFileSync(
      path.join(dir, 'pages', 'page.html'),
      '<html><body><button data-eval-target="real">Go</button></body></html>'
    )
    const write = (name: string, cases: unknown): void =>
      fs.writeFileSync(path.join(dir, 'cases', `${name}.json`), JSON.stringify(cases))

    write('decisions', [
      {
        id: 'BAD-1',
        note: 'missing marker and broken regex',
        goal: 'g',
        page: { file: 'page.html', url: 'https://x.example/' },
        expect: { action: 'click', target: 'missing-marker', urlMatches: '([' }
      },
      {
        id: 'BAD-2',
        note: 'missing fixture',
        goal: 'g',
        page: { file: 'nope.html', url: 'https://x.example/' },
        expect: { action: 'click' }
      }
    ])
    write('repairs', [])
    write('goals', [
      {
        id: 'BAD-3',
        note: 'start outside pages, transition to nowhere',
        goal: 'g',
        start: 'ghost',
        pages: { page: { file: 'page.html', url: 'https://x.example/' } },
        transitions: [{ on: { kind: 'click', target: 'real' }, goto: 'ghost' }],
        stepCap: 999,
        expect: { status: 'done' }
      }
    ])

    let message = ''
    try {
      loadDataset(dir)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('BAD-1: expect.target names marker "missing-marker"')
    expect(message).toContain('is not a valid regex')
    expect(message).toContain('BAD-2')
    expect(message).toContain('start "ghost" is not in pages')
    expect(message).toContain('goto "ghost" is not in pages')
    expect(message).toContain('stepCap')
  })
})
