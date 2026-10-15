import { describe, expect, it } from 'vitest'
import { preferLiveAgentAvatar, toAiAvatarProps } from './agent-avatar'
import { DEFAULT_BOT_ORB_COLOR } from './bot-orb-shapes'

describe('toAiAvatarProps', () => {
  it('leaves missing kind as pending (no initials flash)', () => {
    const props = toAiAvatarProps(null, 'Support agent')
    expect(props.kind).toBeNull()
    expect(props.color).toBe(DEFAULT_BOT_ORB_COLOR)
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
