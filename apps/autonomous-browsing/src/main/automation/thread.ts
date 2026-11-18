import type Anthropic from '@anthropic-ai/sdk'

export const PRUNED_NOTE = 'the page for this step is no longer in context'

export const KEEP_PAGES = 2

// A user turn's first text block is the durable summary the model relies on later; the rest is prunable page state.
export function pruneThread(
  messages: Anthropic.MessageParam[],
  keepPages: number
): Anthropic.MessageParam[] {
  const pageTurns: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') pageTurns.push(index)
  })

  const keep = new Set(pageTurns.slice(-Math.max(keepPages, 1)))

  return messages.map((message, index) => {
    if (message.role !== 'user' || keep.has(index)) return message
    return { role: 'user', content: stripPage(message.content) }
  })
}

function stripPage(
  content: Anthropic.MessageParam['content']
): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return content

  const hasToolResult = content.some((block) => block.type === 'tool_result')
  if (!hasToolResult) return summarise(content)

  return content.map((block) => {
    if (block.type !== 'tool_result') return block
    return { ...block, content: summarise(block.content) }
  })
}

type PrunableBlock = Anthropic.ContentBlockParam | Anthropic.ToolReferenceBlockParam

function summarise(
  blocks: string | PrunableBlock[] | undefined
): Anthropic.TextBlockParam[] {
  if (typeof blocks === 'string') return [{ type: 'text', text: blocks }]

  const firstText = blocks?.find(
    (block): block is Anthropic.TextBlockParam => block.type === 'text'
  )
  if (firstText) return [firstText]
  return [{ type: 'text', text: PRUNED_NOTE }]
}
