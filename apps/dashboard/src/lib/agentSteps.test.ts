import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { AgentStep } from '../hooks/useSignalStream'
import { activityStatusLines } from './agentSteps'

const t = ((key: string, opts?: { name?: string }) => {
  if (key === 'agentSteps.thinkingActive') return 'Thinking...'
  if (key === 'agentSteps.writing') return 'Writing...'
  if (key === 'agentSteps.thought') return 'Thought'
  if (key === 'agentSteps.runningTool') return `Running ${opts?.name ?? 'tool'}`
  if (key === 'agentSteps.finishedTool') return `Finished ${opts?.name ?? 'tool'}`
  if (key === 'agentSteps.toolFallback') return 'tool'
  if (key === 'agentSteps.consultingKnowledge') return 'Consulting knowledge...'
  if (key === 'agentSteps.consultedKnowledge') return 'Consulted knowledge'
  return key
}) as unknown as TFunction

function step(partial: Partial<AgentStep> & Pick<AgentStep, 'stepType'>): AgentStep {
  return {
    id: partial.id ?? partial.stepType,
    name: partial.name ?? '',
    payload: partial.payload ?? {},
    ...partial,
  }
}

describe('activityStatusLines', () => {
  it('stacks unique step headlines and appends the current headline', () => {
    const lines = activityStatusLines(
      [
        step({ id: '1', stepType: 'tool_call', name: 'search_index' }),
        step({ id: '2', stepType: 'tool_result', name: 'search_index' }),
        step({ id: '3', stepType: 'tool_call', name: 'accounting_list_companies' }),
      ],
      true,
      t,
    )
    expect(lines).toEqual([
      'Consulting knowledge...',
      'Consulted knowledge',
      'Running accounting_list_companies',
    ])
  })

  it('uses Writing as the current line once stream text arrives', () => {
    const lines = activityStatusLines(
      [step({ id: '1', stepType: 'tool_call', name: 'list_docs' })],
      true,
      t,
      { streamText: 'Bakker BV' },
    )
    expect(lines.at(-1)).toBe('Writing...')
    expect(lines[0]).toBe('Consulting knowledge...')
  })

  it('falls back to Thinking when active with no steps', () => {
    expect(activityStatusLines([], true, t)).toEqual(['Thinking...'])
  })
})
