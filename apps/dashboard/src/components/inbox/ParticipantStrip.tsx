import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { ThreadActiveTurn, ThreadOwner, ThreadParticipant } from '../../lib/inbox-api'
import { floorKey, participantsToAvatarStack } from '../../lib/participant-stack'
import { AvatarStack } from '../ui/AvatarStack'

type Props = {
  participants: ThreadParticipant[]
  /** Current owner. Shown on the assign control, so the strip skips them. */
  owner?: ThreadOwner | null
  activeTurn?: ThreadActiveTurn
  /** Last sender. Brought to the front when nobody is mid-turn. */
  faceId?: string | null
  waitingLabel?: string
}

function isOwner(participant: ThreadParticipant, owner: ThreadOwner): boolean {
  const kind = (participant.kind || '').trim().toLowerCase()
  if (owner.kind === 'user') return kind === 'user' && participant.ref_id === owner.userId
  if (owner.kind === 'agent') return kind === 'agent' && participant.ref_id === owner.agentId
  return kind === 'team' && participant.ref_id === owner.teamId
}

/** Extra people on the thread. The owner stays on the assign control. */
export function ParticipantStrip({
  participants,
  owner = null,
  activeTurn = null,
  faceId = null,
  waitingLabel,
}: Props) {
  const { members: people } = useMembers()
  const { agents } = useAgents()
  const { teams } = useTeams()
  const roster = participants.filter((participant) => {
    const kind = (participant.kind || '').trim().toLowerCase()
    if (kind === 'contact') return false
    if (owner && isOwner(participant, owner)) return false
    return true
  })
  const onFloor = floorKey(activeTurn)
  const ordered =
    onFloor || !faceId
      ? roster
      : [...roster].sort((a, b) => {
          const aFace = (a.kind || '').toLowerCase() === 'agent' && a.ref_id === faceId ? 0 : 1
          const bFace = (b.kind || '').toLowerCase() === 'agent' && b.ref_id === faceId ? 0 : 1
          return aFace - bFace
        })
  const stack = participantsToAvatarStack(ordered, {
    people,
    agents,
    teams,
    activeTurn,
    expandTeams: false,
  })
  const waitingOn =
    activeTurn?.name ||
    (activeTurn?.ref_id
      ? participants.find((p) => p.ref_id === activeTurn.ref_id)?.name
      : '')
  if (stack.length <= 1 && !waitingOn) return null
  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-1.5"
      data-testid="thread-participants"
    >
      {stack.length > 0 ? (
        <AvatarStack
          members={stack}
          size={20}
          linkAgents={false}
          activeKey={onFloor}
          cutout="bg"
        />
      ) : null}
      {waitingOn ? (
        <span className="truncate text-2xs text-text-muted">
          {waitingLabel
            ? waitingLabel.replace('{{name}}', waitingOn)
            : `Waiting on ${waitingOn}`}
        </span>
      ) : null}
    </div>
  )
}
