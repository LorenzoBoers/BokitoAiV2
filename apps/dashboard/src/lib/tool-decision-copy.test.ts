import { describe, expect, it } from 'vitest'
import { formatToolDecisionSummary } from './tool-decision-copy'

describe('formatToolDecisionSummary', () => {
  it('rewrites legacy MCP JSON into plain language', () => {
    const result = formatToolDecisionSummary(
      '{"server_name":"mock-tools","tool_name":"list_tools","arguments":{}}',
      'Approve action: call_mcp_tool',
    )
    expect(result?.title).toBe('Approve: List tools on mock-tools')
    expect(result?.summary).toContain('list_tools')
    expect(result?.summary).not.toContain('{')
  })

  it('returns null for already-readable summaries', () => {
    expect(
      formatToolDecisionSummary('The agent wants to run get_order on shopify.', 'Approve: Get order'),
    ).toBeNull()
  })
})
