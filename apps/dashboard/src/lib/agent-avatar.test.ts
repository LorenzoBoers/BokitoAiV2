import { describe, expect, it } from 'vitest'
import { preferLiveAgentAvatar, toAiAvatarProps } from './agent-avatar'

describe('toAiAvatarProps', () => {
  it('uses a pending shell when the agent is not loaded yet', () => {
    const props = toAiAvatarProps(null, 'Support agent')
    expect(props.kind).toBe('pending')
    expect(props.name).toBe('Support agent')
  })

  it('uses a pending shell for id/name-only rows until the catalog hydrates', () => {
    const props = toAiAvatarProps({ id: 'a1', name: 'Support agent' })
    expect(props.kind).toBe('pending')
    expect(props.name).toBe('Support agent')
  })

  it('keeps explicit initials', () => {
    const props = toAiAvatarProps({
      name: 'Support agent',
      avatar_kind: 'initials',
    })
    expect(props.kind).toBe('initials')
  })

  it('resolves orb color and shape', () => {
    const props = toAiAvatarProps({
      name: 'Support agent',
      avatar_kind: 'orb',
      avatar_color: '#00c972',
      avatar_shape: 'blob',
    })
    expect(props.kind).toBe('orb')
    expect(props.color).toBe('#00c972')
    expect(props.shape).toBe('blob')
  })
})

describe('preferLiveAgentAvatar', () => {
  it('prefers the live catalog mark over stale thread fields', () => {
    const merged = preferLiveAgentAvatar(
      { id: 'a1', name: 'Support agent', avatar_kind: 'orb', avatar_color: '#9159fe', avatar_shape: 'blob' },
      { agentId: 'a1', name: 'Support agent', agentAvatarKind: 'initials' },
    )
    expect(merged?.avatar_kind).toBe('orb')
    expect(merged?.agentAvatarKind).toBe('initials')
  })
})
