import type { AgentAvatarSource } from './agent-avatar'
import type { AvatarStackMember } from '../components/ui/AvatarStack'
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

/** Resolve team member refs into facepile entries (people + agents). */
export function resolveTeamStackMembers(
  refs: TeamMemberRef[] | undefined | null,
  opts: {
    people?: PersonSource[]
    agents?: AgentSource[]
  },
): AvatarStackMember[] {
  if (!refs?.length) return []
  const peopleById = new Map<string, PersonSource>()
  for (const person of opts.people ?? []) {
    if (person.uuid) peopleById.set(person.uuid, person)
    if (person.id != null) peopleById.set(String(person.id), person)
  }
  const agentsById = new Map((opts.agents ?? []).map((agent) => [agent.id, agent]))
  const out: AvatarStackMember[] = []
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`
    if (ref.kind === 'user') {
      const person = peopleById.get(ref.id)
      if (person?.deactivated) continue
      out.push({
        key,
        kind: 'user',
        name: person?.name || 'Member',
        email: person?.email || person?.name || ref.id,
        avatarUrl: person?.avatarUrl ?? person?.avatar_url ?? null,
      })
      continue
    }
    const agent = agentsById.get(ref.id)
    if (agent?.deactivated) continue
    out.push({
      key,
      kind: 'agent',
      name: agent?.name || 'Agent',
      id: ref.id,
      agent: agent ?? { id: ref.id, name: 'Agent' },
    })
  }
  return out
}
