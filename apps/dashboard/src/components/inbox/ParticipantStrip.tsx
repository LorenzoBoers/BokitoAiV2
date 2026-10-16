import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { ThreadActiveTurn, ThreadParticipant } from '../../lib/inbox-api'
import { floorKey, participantsToAvatarStack } from '../../lib/participant-stack'
import { AVATAR_STACK_MAX, AvatarStack } from '../ui/AvatarStack'

type Props = {
  participants: ThreadParticipant[]
  activeTurn?: ThreadActiveTurn
  waitingLabel?: string
  max?: number
}

/** Compact facepile for everyone on a conversation (hub header / panels). */
export function ParticipantStrip({
  participants,
  activeTurn = null,
  waitingLabel,
  max = AVATAR_STACK_MAX,
}: Props) {
  const { members: people } = useMembers()
  const { agents } = useAgents()
  const { teams } = useTeams()
  const stack = participantsToAvatarStack(participants, {
    people,
    agents,
    teams,
    activeTurn,
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
          size={18}
          linkAgents={false}
          activeKey={floorKey(activeTurn)}
          max={max}
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
