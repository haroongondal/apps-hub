import { describe, expect, it } from 'vitest'
import { ROUTINE_FILE_FORMAT_VERSION, assertRoutineFile } from '../src/shared/routines'
import { classifyUrl, findSecrets, redact, reviewRoutineFile } from '../src/shared/routine-review'
import type { RoutineFile } from '../src/shared/types'

function file(over: Partial<RoutineFile> = {}): RoutineFile {
  return {
    formatVersion: ROUTINE_FILE_FORMAT_VERSION,
    name: 'Invoice pull',
    description: null,
    definition: { steps: [{ kind: 'navigate', url: 'https://billing.example.com/invoices' }] },
    ...over
  }
}

describe('assertRoutineFile', () => {
  it('accepts the four keys the format declares', () => {
    expect(assertRoutineFile(file())).toEqual(file())
  })

  it('refuses a file from a newer app rather than importing it as current', () => {
    expect(() => assertRoutineFile({ ...file(), formatVersion: 99 })).toThrow(/formatVersion 99/)
  })

  it('refuses a file with no formatVersion, which is what an updates/ file looks like', () => {
    const { formatVersion, ...withoutVersion } = file()
    expect(() => assertRoutineFile(withoutVersion)).toThrow(/formatVersion/)
  })

  it('refuses unknown keys, so an updates/ file does not half-import', () => {
    expect(() => assertRoutineFile({ ...file(), id: 'sys.thing', version: 2 })).toThrow(/unknown keys: id, version/)
  })

  it('delegates the definition, so a bad step is reported by position', () => {
    expect(() =>
      assertRoutineFile({ ...file(), definition: { steps: [{ kind: 'click' }] } })
    ).toThrow(/steps\[0\]/)
  })

  it('holds name to the same limit the store does', () => {
    expect(() => assertRoutineFile({ ...file(), name: '   ' })).toThrow(/name is required/)
    expect(() => assertRoutineFile({ ...file(), name: 'x'.repeat(121) })).toThrow(/120 characters/)
  })
})

describe('classifying a navigation destination', () => {
  it('shows the origin of a literal URL', () => {
    expect(classifyUrl('https://billing.example.com/invoices?page=2')).toEqual({
      kind: 'literal',
      origin: 'https://billing.example.com',
      url: 'https://billing.example.com/invoices?page=2'
    })
  })

  it('reports a fully parameterised URL as unknowable, because new URL would throw on it', () => {
    expect(classifyUrl('{{url}}')).toEqual({ kind: 'runtime', params: ['url'] })
  })

  it('splits a mixed URL so the literal half is still reviewable', () => {
    expect(classifyUrl('https://shop.example.com/{{path}}')).toEqual({
      kind: 'mixed',
      prefix: 'https://shop.example.com/',
      params: ['path']
    })
  })
})

describe('reviewing a file before import', () => {
  it('calls a submitting type step certain, and wording only suspected', () => {
    const review = reviewRoutineFile(
      file({
        definition: {
          steps: [
            { kind: 'type', selector: '#q', text: 'socks', submit: true },
            { kind: 'click', selector: '#place-order' },
            { kind: 'click', selector: '#btn-1' }
          ]
        }
      })
    )

    expect(review.commits).toEqual([
      { stepIndex: 0, signal: 'certain', why: expect.stringContaining('presses Enter') },
      { stepIndex: 1, signal: 'suspected', why: expect.stringContaining('place') }
    ])
  })

  it('counts the clicks it cannot classify, because that is the residual risk', () => {
    const review = reviewRoutineFile(
      file({ definition: { steps: [{ kind: 'click', selector: '#btn-1' }, { kind: 'click', selector: '.primary' }] } })
    )
    expect(review.opaqueClicks).toBe(2)
    expect(review.commits).toEqual([])
  })

  it('lists the params the recipient will have to supply', () => {
    const review = reviewRoutineFile(
      file({
        definition: {
          steps: [{ kind: 'navigate', url: '{{url}}' }],
          params: { url: { required: true }, page: { default: '1' } }
        }
      })
    )
    expect(review.requiredParams).toEqual(['url'])
  })
})

describe('redacting before export', () => {
  const withSecrets = file({
    description: 'pull invoices for account 44kj2',
    definition: {
      steps: [
        { kind: 'type', selector: '#key', text: 'sk-live-abc123' },
        { kind: 'type', selector: '#q', text: '{{query}}' }
      ],
      params: { query: { default: 'socks' } }
    }
  })

  it('finds a literal typed value, a param default and the description', () => {
    expect(findSecrets(withSecrets).map((s) => [s.where, s.value])).toEqual([
      ['step', 'sk-live-abc123'],
      ['param', 'socks'],
      ['description', 'pull invoices for account 44kj2']
    ])
  })

  it('leaves a value that is already a param reference alone', () => {
    expect(findSecrets(withSecrets).some((s) => s.value === '{{query}}')).toBe(false)
  })

  it('rewrites the literal to a required param the recipient must fill in', () => {
    const cleaned = redact(withSecrets, findSecrets(withSecrets))
    const typed = cleaned.definition.steps[0]

    expect(typed).toEqual({ kind: 'type', selector: '#key', text: '{{secret_1}}' })
    expect(cleaned.definition.params?.['secret_1']?.required).toBe(true)
    expect(cleaned.definition.params?.['query']?.default).toBeUndefined()
    expect(cleaned.definition.params?.['query']?.required).toBe(true)
    expect(cleaned.description).toBeNull()
  })

  it('produces a file that still validates, or export would write something unimportable', () => {
    const cleaned = redact(withSecrets, findSecrets(withSecrets))
    expect(() => assertRoutineFile(JSON.parse(JSON.stringify(cleaned)))).not.toThrow()
  })

  it('redacts only what it was given, so declining one secret keeps it', () => {
    const only = findSecrets(withSecrets).filter((s) => s.where === 'step')
    const cleaned = redact(withSecrets, only)

    expect(cleaned.description).toBe('pull invoices for account 44kj2')
    expect(cleaned.definition.params?.['query']?.default).toBe('socks')
  })
})
