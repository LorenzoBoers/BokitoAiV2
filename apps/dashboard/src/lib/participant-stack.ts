import type { AvatarStackMember } from '../components/ui/AvatarStack'
import { preferLiveAgentAvatar, type AgentAvatarSource } from './agent-avatar'
import type { ThreadActiveTurn, ThreadParticipant } from './inbox-api'
import { resolveTeamStackMembers } from './team-facepile'
import type { TeamMemberRef } from './teams-api'

type PersonSource = {
  uuid?: string
  id?: string | number
  name: string
  email?: string | null
  avatar_url?: string | null
  avatarUrl?: string | null
  deactivated?: boolean
}

type AgentSource = AgentAvatarSource & {
  id: string
  name: string
  deactivated?: boolean
}

type TeamSource = {
  id: string
  name?: string | null
  members?: TeamMemberRef[]
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
}

/**
 * Thread roster as one facepile. A team expands to its members unless
 * `expandTeams` is false (header: a team is one owner, not every colleague).
 */
export function participantsToAvatarStack(
  participants: ThreadParticipant[],
  opts: {
    people?: PersonSource[]
    agents?: AgentSource[]
    teams?: TeamSource[]
    activeTurn?: ThreadActiveTurn
    expandTeams?: boolean
  } = {},
): AvatarStackMember[] {
  const activeKey = floorKey(opts.activeTurn)
  const seen = new Set<string>()
  const out: AvatarStackMember[] = []

  const push = (member: AvatarStackMember) => {
    if (seen.has(member.key)) return
    seen.add(member.key)
    out.push(member)
  }

  for (const participant of participants) {
    const kind = (participant.kind || '').trim().toLowerCase()
    if (kind === 'team') {
      const team = opts.teams?.find((row) => row.id === participant.ref_id)
      const faces =
        opts.expandTeams === false
          ? []
          : resolveTeamStackMembers(team?.members, {
              people: opts.people,
              agents: opts.agents,
            }).map((member) => withFloor(member, activeKey))
      if (faces.length > 0) {
        for (const face of faces) push(face)
        continue
      }
      push({
        key: `team:${participant.ref_id}`,
        kind: 'team',
        name: participant.name || team?.name || 'Team',
        title: faceTitle(participant, activeKey),
        team: {
          id: participant.ref_id,
          name: participant.name || team?.name,
          avatar_kind: participant.avatar_kind ?? team?.avatar_kind,
          avatar_icon: participant.avatar_icon ?? team?.avatar_icon,
          avatar_color: participant.avatar_color ?? team?.avatar_color,
          avatar_image_url: participant.avatar_image_url ?? team?.avatar_image_url,
        },
      })
      continue
    }

    if (kind === 'agent') {
      const live = opts.agents?.find((agent) => agent.id === participant.ref_id)
      const stamped = { ...participant, id: participant.ref_id, name: participant.name }
      push({
        key: `agent:${participant.ref_id}`,
        kind: 'agent',
        name: participant.name || live?.name || 'Agent',
        id: participant.ref_id,
        title: faceTitle(participant, activeKey),
        agent: preferLiveAgentAvatar(live, stamped) ?? stamped,
      })
      continue
    }

    const person =
      kind === 'user'
        ? opts.people?.find(
            (row) => row.uuid === participant.ref_id || String(row.id) === participant.ref_id,
          )
        : undefined
    push({
      key: `${kind || 'user'}:${participant.ref_id}`,
      kind: 'user',
      name: participant.name || person?.name || kind || 'Member',
      email: participant.email || person?.email || participant.name || participant.ref_id,
      avatarUrl: participant.avatar_url ?? person?.avatarUrl ?? person?.avatar_url ?? null,
      title: faceTitle(participant, activeKey),
    })
  }

  return out
}

export function visibleFloor(activeTurn?: ThreadActiveTurn): ThreadActiveTurn {
  if (!activeTurn?.ref_id?.trim()) return null
  return activeTurn
}

export function floorKey(activeTurn?: ThreadActiveTurn): string | null {
  const ref = activeTurn?.ref_id?.trim()
  if (!ref) return null
  const kind = (activeTurn?.kind || '').trim().toLowerCase()
  return `${kind || 'user'}:${ref}`
}

function withFloor(member: AvatarStackMember, activeKey: string | null): AvatarStackMember {
  if (!activeKey || member.key !== activeKey) return member
  return { ...member, title: `${member.name} · floor` }
}

function faceTitle(participant: ThreadParticipant, activeKey: string | null): string {
  const kind = (participant.kind || '').trim().toLowerCase()
  const name = (participant.name || '').trim() || kind || 'Member'
  const bits = [name]
  if (participant.role === 'owner') bits.push('owner')
  if (activeKey && activeKey === `${kind}:${participant.ref_id}`) bits.push('floor')
  return bits.join(' · ')
}
