import type Anthropic from '@anthropic-ai/sdk'
import { describeAvoid, describePage } from '../../src/main/automation/claude-client'
import type { PageSnapshot } from '../../src/main/automation/session'
import type { PriorTurn } from './types'

// Reproduces the thread shape runChatGoal sends after pruneThread has run.
export function decisionThread(
  goal: string,
  snapshot: PageSnapshot,
  prior: PriorTurn[],
  avoid: string[]
): Anthropic.MessageParam[] {
  const page = pageText(snapshot, avoid)

  if (prior.length === 0) {
    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Goal: ${goal}` },
          { type: 'text', text: page }
        ]
      }
    ]
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: `Goal: ${goal}` }] }
  ]
  prior.forEach((turn, index) => {
    const id = `eval-prior-${index}`
    const last = index === prior.length - 1
    messages.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'decide_next_action', input: turn.decision }]
    })
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: last
            ? [
                { type: 'text', text: turn.outcome },
                { type: 'text', text: page }
              ]
            : [{ type: 'text', text: turn.outcome }]
        }
      ]
    })
  })
  return messages
}

export function pageText(snapshot: PageSnapshot, avoid: string[]): string {
  const sections = describePage(snapshot)
  if (avoid.length > 0) sections.push(describeAvoid(avoid))
  return sections.join('\n\n')
}
