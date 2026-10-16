import { ParticipantMark } from '../ui/ParticipantMark'
import type { ThreadActiveTurn, ThreadParticipant } from '../../lib/inbox-api'

type Props = {
  participants: ThreadParticipant[]
  activeTurn?: ThreadActiveTurn
  waitingLabel?: string
  max?: number
}

/** Compact avatar row for multi-party conversations (hub header / panels). */
export function ParticipantStrip({
  participants,
  activeTurn = null,
  waitingLabel,
  max = 6,
}: Props) {
  const strip = participants.slice(0, max)
  const waitingOn =
    activeTurn?.name ||
    (activeTurn?.ref_id
      ? participants.find((p) => p.ref_id === activeTurn.ref_id)?.name
      : '')
  if (strip.length <= 1 && !waitingOn) return null
  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-1.5"
      data-testid="thread-participants"
    >
      <div className="flex -space-x-1.5">
        {strip.map((p) => {
          const hasFloor = Boolean(
            activeTurn?.ref_id && p.ref_id === activeTurn.ref_id && p.kind === activeTurn.kind,
          )
          return (
            <span
              key={`${p.kind}:${p.ref_id}`}
              title={`${p.name || p.kind}${p.role === 'owner' ? ' (owner)' : ''}${
                hasFloor ? ' · floor' : ''
              }`}
              className={
                hasFloor
                  ? 'inline-flex rounded-full ring-2 ring-accent'
                  : 'inline-flex rounded-full ring-1 ring-bg-surface'
              }
            >
              <ParticipantMark participant={p} size={18} />
            </span>
          )
        })}
      </div>
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
