import { describe, expect, it } from 'vitest'
import { decisionSourcePath, parseDecisionSource } from './decision-source'

describe('parseDecisionSource', () => {
  it('reads a queue item with its project', () => {
    expect(
      parseDecisionSource({ type: 'agent_task', id: 'task-1', project_id: 'proj-1' }),
    ).toEqual({ type: 'agent_task', id: 'task-1', projectId: 'proj-1' })
  })

  it('ignores unknown or incomplete shapes', () => {
    expect(parseDecisionSource(null)).toBeNull()
    expect(parseDecisionSource({ type: 'mystery', id: 'x' })).toBeNull()
    expect(parseDecisionSource({ type: 'project' })).toBeNull()
  })
})

describe('decisionSourcePath', () => {
  it('sends a queue item to its project, or the agenda without one', () => {
    expect(
      decisionSourcePath({ type: 'agent_task', id: 't', projectId: 'proj-2' }),
    ).toBe('/projects/proj-2')
    expect(decisionSourcePath({ type: 'agent_task', id: 't', projectId: null })).toBe('/agenda')
  })

  it('sends runs to activity and platform changes to Govern drafts', () => {
    expect(decisionSourcePath({ type: 'agent_run', id: 'r', projectId: null })).toBe('/activity')
    expect(decisionSourcePath({ type: 'platform_change', id: 'c', projectId: null })).toBe(
      '/settings/govern?tab=drafts',
    )
  })
})
