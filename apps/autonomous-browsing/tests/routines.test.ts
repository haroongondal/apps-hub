import { describe, expect, it } from 'vitest'
import { definitionHash } from '../src/shared/routine-hash'
import {
  applyRepairs,
  assertRoutineDefinition,
  describeStep,
  isLikeForLike,
  isStaleRepair,
  requiredParams,
  resolveStep
} from '../src/shared/routines'
import type { ActionStep, StepRepair } from '../src/shared/types'

describe('assertRoutineDefinition', () => {
  it('accepts a valid definition', () => {
    const definition = {
      params: { url: { description: 'Target', required: true } },
      steps: [
        { kind: 'navigate', url: '{{url}}' },
        { kind: 'type', selector: '#q', text: 'hello', submit: true },
        { kind: 'wait', forSelector: '#results' },
        { kind: 'screenshot' }
      ]
    }
    expect(assertRoutineDefinition(definition)).toBe(definition)
  })

  it('rejects non-objects and empty steps', () => {
    expect(() => assertRoutineDefinition(null)).toThrow(/object/)
    expect(() => assertRoutineDefinition({ steps: [] })).toThrow(/non-empty/)
  })

  it('rejects unknown step kinds and unknown keys', () => {
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'teleport' }] })).toThrow(/unknown kind/)
    expect(() =>
      assertRoutineDefinition({ steps: [{ kind: 'click', selector: '#a', hover: true }] })
    ).toThrow(/unknown key/)
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'click', selector: '#a' }], extra: 1 })).toThrow(
      /unknown keys/
    )
  })

  it('rejects missing or mistyped fields', () => {
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'navigate' }] })).toThrow(/url is required/)
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'navigate', url: 42 }] })).toThrow(/must be a string/)
  })

  it('enforces cross-field constraints', () => {
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'wait' }] })).toThrow(/"ms" or "forSelector"/)
    expect(() =>
      assertRoutineDefinition({ steps: [{ kind: 'scroll', to: 'sideways' }] })
    ).toThrow(/"top" or "bottom"/)
  })

  it('validates param declarations', () => {
    expect(() =>
      assertRoutineDefinition({ steps: [{ kind: 'screenshot' }], params: { q: { typo: 1 } } })
    ).toThrow(/unknown key/)
  })

  // A run's per-step timeout is derived from the step, so an unbounded wait
  // would park the run and the socket request behind it indefinitely.
  it('bounds how long a wait step may park the run', () => {
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'wait', ms: 300_000 }] })).not.toThrow()
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'wait', ms: 300_001 }] })).toThrow(/between 0 and 300000/)
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'wait', ms: -1 }] })).toThrow(/between 0 and 300000/)
  })
})

// A repair is evidence that one selector worked once, not that a routine should
// be rewritten. Only a same-kind, single-action replacement is worth keeping.
describe('a definition with a hole in its steps', () => {
  it('is refused, because forEach skips holes and a hole serialises to null', () => {
    const sparse: unknown[] = [{ kind: 'click', selector: '#a' }]
    sparse[2] = { kind: 'click', selector: '#c' }

    expect(() => assertRoutineDefinition({ steps: sparse })).toThrow(/steps\[1\]/)
  })
})

describe('isStaleRepair', () => {
  const original: ActionStep = { kind: 'click', selector: '#old' }
  const repair: StepRepair = {
    stepIndex: 1,
    reason: 'moved',
    original,
    replacement: [{ kind: 'click', selector: '#new' }]
  }

  it('is fresh while the step it fixed is still the step at that index', () => {
    const definition = { steps: [{ kind: 'navigate', url: 'https://a.com' } as ActionStep, original] }
    expect(isStaleRepair(repair, definition)).toBe(false)
  })

  it('is stale once the step has been edited, so an accept cannot overwrite the edit', () => {
    const edited = { steps: [{ kind: 'navigate', url: 'https://a.com' } as ActionStep, { kind: 'click', selector: '#hand-edited' } as ActionStep] }
    expect(isStaleRepair(repair, edited)).toBe(true)
  })

  it('is stale once the routine is shorter than the index, which is what punches the hole', () => {
    const shortened = { steps: [{ kind: 'navigate', url: 'https://a.com' } as ActionStep] }
    expect(isStaleRepair(repair, shortened)).toBe(true)
  })
})

describe('isLikeForLike', () => {
  const original: ActionStep = { kind: 'click', selector: '#old' }
  const repair = (replacement: ActionStep[]): StepRepair => ({
    stepIndex: 1,
    reason: 'the button moved',
    original,
    replacement
  })

  it('accepts a single same-kind replacement, which is the only shape Accept can write', () => {
    expect(isLikeForLike(repair([{ kind: 'click', selector: '#new' }]))).toBe(true)
  })

  it('refuses a multi-step workaround, which worked around page state that will not recur', () => {
    const workaround: ActionStep[] = [
      { kind: 'click', selector: '#dismiss-cookies' },
      { kind: 'click', selector: '#new' }
    ]
    expect(isLikeForLike(repair(workaround))).toBe(false)
  })

  it('refuses a kind change and an empty replacement', () => {
    expect(isLikeForLike(repair([{ kind: 'wait', ms: 500 }]))).toBe(false)
    expect(isLikeForLike(repair([]))).toBe(false)
  })

  it('agrees with applyRepairs on every shape, because Accept must not be offered for a no-op', () => {
    const definition = { steps: [{ kind: 'navigate', url: 'https://a.com' } as ActionStep, original] }
    const shapes: ActionStep[][] = [
      [{ kind: 'click', selector: '#new' }],
      [{ kind: 'wait', ms: 500 }],
      [],
      [
        { kind: 'click', selector: '#a' },
        { kind: 'click', selector: '#b' }
      ]
    ]
    for (const replacement of shapes) {
      const changed = applyRepairs(definition, [repair(replacement)]).steps[1] !== original
      expect(changed).toBe(isLikeForLike(repair(replacement)))
    }
  })
})

describe('applyRepairs', () => {
  const original: ActionStep = { kind: 'click', selector: '#old' }
  const definition = { steps: [{ kind: 'navigate', url: 'https://a.com' } as ActionStep, original] }

  function repair(replacement: ActionStep[]): StepRepair {
    return { stepIndex: 1, reason: 'the button moved', original, replacement }
  }

  it('adopts a like-for-like replacement', () => {
    const updated = applyRepairs(definition, [repair([{ kind: 'click', selector: '#new' }])])

    expect(updated.steps[1]).toEqual({ kind: 'click', selector: '#new' })
    expect(definition.steps[1]).toBe(original)
  })

  it('leaves the routine alone when the repair needed several actions', () => {
    const workaround = [
      { kind: 'click', selector: '#dismiss-cookies' } as ActionStep,
      { kind: 'click', selector: '#new' } as ActionStep
    ]

    expect(applyRepairs(definition, [repair(workaround)]).steps[1]).toBe(original)
  })

  it('leaves the routine alone when the replacement is a different kind of step', () => {
    expect(applyRepairs(definition, [repair([{ kind: 'wait', ms: 500 }])]).steps[1]).toBe(original)
  })

  it('keeps a repaired definition valid, intent and all', () => {
    const updated = applyRepairs(definition, [repair([{ kind: 'click', selector: '#new', intent: 'press send' }])])

    expect(() => assertRoutineDefinition(updated)).not.toThrow()
  })
})

describe('the assert step kind', () => {
  const assertion = (extra: Record<string, unknown> = {}): unknown => ({
    steps: [{ kind: 'assert', selector: '#done', ...extra }]
  })

  it('accepts presence, absence, and a text claim', () => {
    expect(() => assertRoutineDefinition(assertion())).not.toThrow()
    expect(() => assertRoutineDefinition(assertion({ expect: 'present' }))).not.toThrow()
    expect(() => assertRoutineDefinition(assertion({ expect: 'absent' }))).not.toThrow()
    expect(() => assertRoutineDefinition(assertion({ containsText: 'Order #{{id}}' }))).not.toThrow()
    expect(() => assertRoutineDefinition(assertion({ message: 'the receipt never rendered' }))).not.toThrow()
  })

  // checkFields would let `expect: 'banana'` through as a string?, so the two
  // rules below are the whole of this step kind's validation.
  it('rejects an expect value outside the pair', () => {
    expect(() => assertRoutineDefinition(assertion({ expect: 'banana' }))).toThrow(/"present" or "absent"/)
  })

  it('rejects absent combined with containsText, which cannot both hold', () => {
    expect(() => assertRoutineDefinition(assertion({ expect: 'absent', containsText: 'gone' }))).toThrow(
      /cannot ask for text/
    )
  })

  it('rejects a missing selector and unknown keys', () => {
    expect(() => assertRoutineDefinition({ steps: [{ kind: 'assert' }] })).toThrow(/selector is required/)
    expect(() => assertRoutineDefinition(assertion({ timeout: 500 }))).toThrow(/unknown key/)
  })
})

describe('definitionHash', () => {
  const steps: ActionStep[] = [
    { kind: 'navigate', url: 'https://a.test' },
    { kind: 'type', selector: '#q', text: 'hello', submit: true }
  ]

  it("is stable under key reordering, because assertRoutineDefinition returns the caller's object untouched", () => {
    const reordered = [
      { kind: 'navigate', url: 'https://a.test' },
      { submit: true, text: 'hello', selector: '#q', kind: 'type' }
    ] as unknown as ActionStep[]
    expect(definitionHash({ steps: reordered })).toBe(definitionHash({ steps }))
  })

  it('changes on a selector edit, the drift a step-count comparison cannot see', () => {
    const edited: ActionStep[] = [steps[0]!, { kind: 'type', selector: '#search', text: 'hello', submit: true }]
    expect(definitionHash({ steps: edited })).not.toBe(definitionHash({ steps }))
  })

  it('changes on a navigate url edit', () => {
    const edited: ActionStep[] = [{ kind: 'navigate', url: 'https://b.test' }, steps[1]!]
    expect(definitionHash({ steps: edited })).not.toBe(definitionHash({ steps }))
  })

  it('hashes the steps only, so a params or description edit is not drift', () => {
    const bare = { steps }
    const declared = { steps, params: { q: { required: true, description: 'Query' } } }
    expect(definitionHash(declared)).toBe(definitionHash(bare))
  })
})

describe('requiredParams', () => {
  const definition = {
    steps: [{ kind: 'navigate', url: '{{url}}' } as ActionStep],
    params: {
      url: { required: true },
      region: { description: 'Region' },
      token: { required: true }
    }
  }

  it('returns the required names left blank, in declaration order', () => {
    expect(requiredParams(definition, {})).toEqual(['url', 'token'])
    expect(requiredParams(definition, { url: 'https://a.test' })).toEqual(['token'])
  })

  it('treats whitespace-only as blank, matching the renderer form it was extracted from', () => {
    expect(requiredParams(definition, { url: '   ', token: 'x' })).toEqual(['url'])
  })

  it('never demands an optional param, and is empty once every required one is filled', () => {
    expect(requiredParams(definition, { url: 'x', token: 'y' })).toEqual([])
    expect(requiredParams({ steps: definition.steps }, {})).toEqual([])
  })
})

describe('describeStep and resolveStep over assert', () => {
  it('describes each shape distinctly', () => {
    expect(describeStep({ kind: 'assert', selector: '#done' })).toMatch(/#done/)
    expect(describeStep({ kind: 'assert', selector: '#err', expect: 'absent' })).toMatch(/gone|absent|no /i)
    expect(describeStep({ kind: 'assert', selector: '#r', containsText: 'A1' })).toMatch(/A1/)
  })

  it('substitutes params into containsText but never into the selector', () => {
    const step: ActionStep = { kind: 'assert', selector: '#o-{{id}}', containsText: 'Order {{id}}' }
    const resolved = resolveStep(step, { id: '77' })
    expect(resolved).toEqual({ kind: 'assert', selector: '#o-{{id}}', containsText: 'Order 77' })
  })

  it('leaves an assertion without text untouched', () => {
    const step: ActionStep = { kind: 'assert', selector: '#done', expect: 'absent' }
    expect(resolveStep(step, { id: '77' })).toEqual(step)
  })
})
