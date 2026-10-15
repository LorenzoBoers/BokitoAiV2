/**
 * LinkedIn-style stacked emoji reactions on Communication timeline messages.
 *
 * Intentional emoji exception for this surface only — do not copy emoji into
 * other product UI (see .cursor/rules/no-emoticons-ui-copy.mdc).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { cn } from '../../lib/utils'
import {
  clearMessageReaction,
  setMessageReaction,
  type MessageReactionAggregate,
  type ReactionKind,
} from '../../lib/signals-api'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** Human-facing palette (agents may also use investigating via tools). */
export const HUMAN_REACTION_KINDS: ReactionKind[] = [
  'up',
  'down',
  'hundred',
  'angry',
  'thinking',
]

export const REACTION_EMOJI: Record<ReactionKind, string> = {
  up: '👍',
  down: '👎',
  hundred: '💯',
  angry: '😠',
  thinking: '🤔',
  investigating: '🔍',
}

type Props = {
  messageId: string
  initial?: MessageReactionAggregate | null
  /** When the parent patches from WS / optimistic updates. */
  onChange?: (next: MessageReactionAggregate) => void
  className?: string
}

export function MessageReactions({ messageId, initial, onChange, className }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [aggregate, setAggregate] = useState<MessageReactionAggregate>(
    () => initial ?? { kinds: [], mine: null },
  )
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (busy) return
    setAggregate(initial ?? { kinds: [], mine: null })
  }, [initial, busy])

  const apply = useCallback(
    (next: MessageReactionAggregate) => {
      setAggregate(next)
      onChange?.(next)
    },
    [onChange],
  )

  const pick = useCallback(
    async (kind: ReactionKind) => {
      if (!token || busy) return
      const previous = aggregate
      const optimistic: MessageReactionAggregate =
        aggregate.mine === kind
          ? { kinds: stripMine(aggregate, kind), mine: null }
          : upsertMine(aggregate, kind)
      apply(optimistic)
      setBusy(true)
      setOpen(false)
      try {
        const next =
          previous.mine === kind
            ? await clearMessageReaction(token, messageId)
            : await setMessageReaction(token, messageId, kind)
        apply(next)
      } catch {
        apply(previous)
        toast.error(t('reactions.error'))
      } finally {
        setBusy(false)
      }
    },
    [token, busy, aggregate, apply, messageId, t],
  )

  const hasStack = aggregate.kinds.length > 0
  const labelFor = useMemo(
    () =>
      ({
        up: t('reactions.kinds.up'),
        down: t('reactions.kinds.down'),
        hundred: t('reactions.kinds.hundred'),
        angry: t('reactions.kinds.angry'),
        thinking: t('reactions.kinds.thinking'),
        investigating: t('reactions.kinds.investigating'),
      }) satisfies Record<ReactionKind, string>,
    [t],
  )

  return (
    <div
      className={cn('relative flex items-end justify-end', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open || !hasStack ? (
        <div
          className={cn(
            'flex items-center gap-0.5 rounded-full border border-border/60 bg-bg-surface px-1 py-0.5 shadow-sm',
            !hasStack && !open && 'opacity-0 transition-opacity group-hover/bubble:opacity-100 focus-within:opacity-100',
            open && 'opacity-100',
          )}
          role="group"
          aria-label={t('reactions.pickerLabel')}
        >
          {HUMAN_REACTION_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={busy}
              aria-label={labelFor[kind]}
              title={labelFor[kind]}
              onClick={() => void pick(kind)}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[13px] leading-none transition-transform hover:scale-110',
                aggregate.mine === kind && 'bg-accent/15 ring-1 ring-accent/40',
              )}
            >
              <span aria-hidden="true">{REACTION_EMOJI[kind]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {hasStack ? (
        <div
          className={cn(
            'flex items-center',
            open && 'ml-1',
          )}
        >
          {aggregate.kinds.map((entry, index) => {
            const names = entry.reactors.map((r) => r.name).filter(Boolean)
            const tip =
              names.length > 0
                ? `${labelFor[entry.kind]}: ${names.join(', ')}${
                    entry.count > names.length ? ` +${entry.count - names.length}` : ''
                  }`
                : labelFor[entry.kind]
            return (
              <Tooltip key={entry.kind}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={tip}
                    onClick={() => void pick(entry.kind)}
                    className={cn(
                      'relative flex h-6 min-w-6 items-center justify-center rounded-full border border-border/70 bg-bg-surface px-1 text-[12px] leading-none shadow-sm',
                      index > 0 && '-ml-1.5',
                      aggregate.mine === entry.kind && 'ring-1 ring-accent/50',
                    )}
                    style={{ zIndex: aggregate.kinds.length - index }}
                  >
                    <span aria-hidden="true">{entry.emoji || REACTION_EMOJI[entry.kind]}</span>
                    {entry.count > 1 ? (
                      <span className="ml-0.5 text-[10px] font-medium tabular-nums text-text-muted">
                        {entry.count}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{tip}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function upsertMine(
  aggregate: MessageReactionAggregate,
  kind: ReactionKind,
): MessageReactionAggregate {
  const without = stripMine(aggregate, aggregate.mine)
  const existing = without.kinds.find((k) => k.kind === kind)
  const kinds = existing
    ? without.kinds.map((k) =>
        k.kind === kind
          ? {
              ...k,
              count: k.count + 1,
              reactors: [{ actorType: 'user' as const, actorId: 'me', name: 'You' }, ...k.reactors].slice(
                0,
                5,
              ),
            }
          : k,
      )
    : [
        ...without.kinds,
        {
          kind,
          emoji: REACTION_EMOJI[kind],
          count: 1,
          reactors: [{ actorType: 'user' as const, actorId: 'me', name: 'You' }],
        },
      ]
  return { kinds, mine: kind }
}

function stripMine(
  aggregate: MessageReactionAggregate,
  kind: ReactionKind | null | undefined,
): MessageReactionAggregate {
  if (!kind) return { kinds: [...aggregate.kinds], mine: null }
  const kinds = aggregate.kinds
    .map((entry) => {
      if (entry.kind !== kind) return entry
      const count = Math.max(0, entry.count - 1)
      if (count === 0) return null
      return {
        ...entry,
        count,
        reactors: entry.reactors.filter((r) => r.actorId !== 'me'),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
  return { kinds, mine: null }
}
