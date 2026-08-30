/**
 * Format gated-tool DecisionRequest bodies for operators.
 * Legacy cards stored raw JSON; new cards already use plain language from the API.
 */

export type FormattedToolDecision = {
  title: string | null
  summary: string
}

function humanizeToken(value: string): string {
  const text = value.trim().replace(/[_-]+/g, ' ')
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatArgs(argumentsValue: unknown, limit = 8): string[] {
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    return []
  }
  const entries = Object.entries(argumentsValue as Record<string, unknown>)
  if (entries.length === 0) return []
  const lines: string[] = []
  for (let i = 0; i < entries.length; i += 1) {
    if (i >= limit) {
      lines.push(`- …and ${entries.length - limit} more`)
      break
    }
    const [key, value] = entries[i]
    let rendered =
      value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
    if (rendered.length > 120) rendered = `${rendered.slice(0, 117)}…`
    lines.push(`- ${humanizeToken(key)}: ${rendered}`)
  }
  return lines
}

/** Parse a legacy JSON tool_input summary into readable copy. */
export function formatToolDecisionSummary(
  summary: string | null | undefined,
  subject?: string | null,
): FormattedToolDecision | null {
  const raw = (summary || '').trim()
  if (!raw.startsWith('{')) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const server = typeof parsed.server_name === 'string' ? parsed.server_name.trim() : ''
  const remote = typeof parsed.tool_name === 'string' ? parsed.tool_name.trim() : ''
  if (server && remote) {
    const argLines = formatArgs(parsed.arguments)
    const lines = [`The agent wants to run ${remote} on ${server}.`]
    if (argLines.length) {
      lines.push('Arguments:')
      lines.push(...argLines)
    } else {
      lines.push('No arguments.')
    }
    return {
      title: `Approve: ${humanizeToken(remote)} on ${server}`,
      summary: lines.join('\n'),
    }
  }

  // Generic tool_input dump (create_task, etc.)
  const approveMatch = (subject || '').match(/^Approve action:\s*(.+)$/i)
  const tool = approveMatch?.[1]?.trim()
  if (!tool && Object.keys(parsed).length === 0) return null
  const verb = tool ? humanizeToken(tool) : 'action'
  const argLines = formatArgs(parsed)
  const lines = [`The agent wants to ${verb.toLowerCase()}.`]
  if (argLines.length) lines.push(...argLines)
  return {
    title: approveMatch ? `Approve: ${verb}` : null,
    summary: lines.join('\n'),
  }
}
