import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { PRUNED_NOTE, pruneThread } from '../src/main/automation/thread'
import { pageTurn } from '../src/main/automation/orchestrator'
import type { PageSnapshot } from '../src/main/automation/session'

function assistantTurn(id: string): Anthropic.MessageParam {
  return {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: `sig-${id}` },
      { type: 'tool_use', id, name: 'decide_next_action', input: { action: 'click' } }
    ] as unknown as Anthropic.ContentBlockParam[]
  }
}

function stepTurn(id: string, outcome: string): Anthropic.MessageParam {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content: [
          { type: 'text', text: outcome },
          { type: 'text', text: '<html>a very large page</html>' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }
        ]
      }
    ] as unknown as Anthropic.ContentBlockParam[]
  }
}

function thread(steps: number): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: 'Goal: book a flight' }] }
  ]
  for (let i = 0; i < steps; i++) {
    messages.push(assistantTurn(`t${i}`), stepTurn(`t${i}`, `step ${i} ran`))
  }
  return messages
}

function blocksOf(message: Anthropic.MessageParam): Anthropic.ContentBlockParam[] {
  if (typeof message.content === 'string') throw new Error('expected blocks')
  return message.content
}

describe('pruneThread', () => {
  it('leaves a thread shorter than the budget completely alone', () => {
    const before = thread(2)
    expect(pruneThread(before, 3)).toEqual(before)
  })

  it('keeps the page on the most recent turns and drops it from older ones', () => {
    const pruned = pruneThread(thread(5), 2)
    const userTurns = pruned.filter((m) => m.role === 'user')

    const oldest = blocksOf(userTurns[1] as Anthropic.MessageParam)[0] as { content: unknown[] }
    expect(oldest.content).toEqual([{ type: 'text', text: 'step 0 ran' }])

    const newest = blocksOf(userTurns[userTurns.length - 1] as Anthropic.MessageParam)[0] as {
      content: unknown[]
    }
    expect(newest.content).toHaveLength(3)
  })

  it('never touches an assistant turn, because thinking blocks must replay verbatim', () => {
    const before = thread(5)
    const pruned = pruneThread(before, 1)
    const assistantsBefore = before.filter((m) => m.role === 'assistant')
    const assistantsAfter = pruned.filter((m) => m.role === 'assistant')
    expect(assistantsAfter).toEqual(assistantsBefore)
  })

  it('keeps every tool_use paired with its tool_result', () => {
    const pruned = pruneThread(thread(5), 2)
    const useIds: string[] = []
    const resultIds: string[] = []
    for (const message of pruned) {
      for (const block of blocksOf(message)) {
        if (block.type === 'tool_use') useIds.push(block.id)
        if (block.type === 'tool_result') resultIds.push(block.tool_use_id)
      }
    }
    expect(useIds).toEqual(['t0', 't1', 't2', 't3', 't4'])
    expect(resultIds).toEqual(useIds)
  })

  it('never leaves a tool_result with empty content, which the API rejects', () => {
    const orphan: Anthropic.MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'Goal' }] },
      assistantTurn('t0'),
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't0',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }
            ]
          }
        ] as unknown as Anthropic.ContentBlockParam[]
      },
      assistantTurn('t1'),
      stepTurn('t1', 'step 1 ran')
    ]
    const pruned = pruneThread(orphan, 1)
    const result = blocksOf(pruned[2] as Anthropic.MessageParam)[0] as { content: unknown[] }
    expect(result.content).toEqual([{ type: 'text', text: PRUNED_NOTE }])
  })

  it('is idempotent, so pruning an already-pruned thread changes nothing', () => {
    const once = pruneThread(thread(6), 2)
    expect(pruneThread(once, 2)).toEqual(once)
  })
})

function snapshotAt(url: string): PageSnapshot {
  return { url, title: null, screenshotBase64: null, screenshotError: null, dom: '<p>page</p>', domError: null, blockedBy: null }
}

describe('pageTurn hints', () => {
  const snapshot = snapshotAt('https://example.com/a')

  it('puts hints in the first block, the one pruning keeps', () => {
    const blocks = pageTurn('step 1 ran', '<p>page</p>', snapshot, 'Notes: the search box is input#q')
    const first = blocks[0] as { type: 'text'; text: string }
    expect(first.text).toContain('the search box is input#q')
  })

  it('leaves the first block alone when there is nothing to say', () => {
    const blocks = pageTurn('step 1 ran', '<p>page</p>', snapshot, '')
    const first = blocks[0] as { type: 'text'; text: string }
    expect(first.text).toBe('step 1 ran\nURL at this point: https://example.com/a')
  })

  it('survives pruning, because the page block does not', () => {
    const turn: Anthropic.MessageParam = {
      role: 'user',
      content: pageTurn('step 1 ran', '<p>a very large page</p>', snapshot, 'Notes: input#q') as never
    }
    const pruned = pruneThread([turn, { role: 'user', content: [{ type: 'text', text: 'later' }] }], 1)
    expect(JSON.stringify(pruned[0])).toContain('input#q')
    expect(JSON.stringify(pruned[0])).not.toContain('a very large page')
  })
})
