/**
 * WhatsApp-style reactions on Communication timeline messages.
 *
 * Applied reactions sit overlapping the bottom edge of the bubble (left for
 * others, right for own). With no reaction yet, bubble hover shows a thumbs-up:
 * click it to like, hover it to open the rest of the palette. Once a stack
 * exists, that stack is the only control — hover it to change; never a second
 * thumbs beside it. Intentional emoji exception for this surface only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  'clap',
  'hundred',
  'thinking',
  'facepalm',
  'down',
]

export const REACTION_EMOJI: Record<ReactionKind, string> = {
  up: '👍',
  down: '👎',
  hundred: '💯',
  facepalm: '🙈',
  clap: '👏',
  thinking: '🤔',
  investigating: '🔍',
}

/** Fixed square so wide glyphs (💯) never stretch the chip into a pill. */
const CHIP_CLASS =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-bg-surface text-[12px] leading-none shadow-sm'

const EMOJI_GLYPH_CLASS =
  'flex size-full items-center justify-center overflow-hidden text-center leading-none [font-size:12px]'

type Props = {
  messageId: string
  initial?: MessageReactionAggregate | null
  /** Bubble side: own messages hang right, everyone else left. */
  side?: 'left' | 'right'
  /** False for your own messages — you can see reactions, not add them. */
  canReact?: boolean
  onChange?: (next: MessageReactionAggregate) => void
  className?: string
}

export function MessageReactions({
  messageId,
  initial,
  side = 'left',
  canReact = true,
  onChange,
  className,
}: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [aggregate, setAggregate] = useState<MessageReactionAggregate>(
    () => initial ?? { kinds: [], mine: null },
  )
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (busy) return
    setAggregate(initial ?? { kinds: [], mine: null })
  }, [initial, busy])

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    },
    [],
  )

  const openMenu = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    setMenuOpen(true)
  }, [])

  const scheduleCloseMenu = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setMenuOpen(false), 120)
  }, [])

  const apply = useCallback(
    (next: MessageReactionAggregate) => {
      setAggregate(next)
      onChange?.(next)
    },
    [onChange],
  )

  const pick = useCallback(
    async (kind: ReactionKind) => {
      if (!canReact || !token || busy) return
      const previous = aggregate
      const optimistic: MessageReactionAggregate =
        aggregate.mine === kind
          ? { kinds: stripMine(aggregate, kind), mine: null }
          : upsertMine(aggregate, kind)
      apply(optimistic)
      setBusy(true)
      setMenuOpen(false)
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
    [canReact, token, busy, aggregate, apply, messageId, t],
  )

  const hasStack = aggregate.kinds.length > 0
  const labelFor = useMemo(
    () =>
      ({
        up: t('reactions.kinds.up'),
        down: t('reactions.kinds.down'),
        hundred: t('reactions.kinds.hundred'),
        facepalm: t('reactions.kinds.facepalm'),
        clap: t('reactions.kinds.clap'),
        thinking: t('reactions.kinds.thinking'),
        investigating: t('reactions.kinds.investigating'),
      }) satisfies Record<ReactionKind, string>,
    [t],
  )

  if (!hasStack && !canReact) return null

  const palette = menuOpen && canReact ? (
    <div
      className={cn(
        'absolute top-full z-50 pt-1.5',
        side === 'right' ? 'right-0' : 'left-0',
      )}
    >
      <div
        role="menu"
        aria-label={t('reactions.pickerLabel')}
        className="flex items-center gap-0.5 rounded-full border border-border/60 bg-bg-surface px-1 py-0.5 text-text-primary shadow-md"
      >
        {HUMAN_REACTION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="menuitem"
            disabled={busy}
            aria-label={labelFor[kind]}
            title={labelFor[kind]}
            onClick={() => void pick(kind)}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full transition-transform hover:scale-110',
              aggregate.mine === kind && 'bg-accent/15 ring-1 ring-accent/40',
            )}
          >
            <span aria-hidden="true" className={EMOJI_GLYPH_CLASS}>
              {REACTION_EMOJI[kind]}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div
      className={cn(
        'z-20 flex items-center gap-0.5',
        // Placed chips: in-flow under the cloud, pulled up to overlap the
        // edge, with margin below so the next bubble cannot cover them.
        hasStack &&
          cn(
            'pointer-events-auto relative -mt-3 mb-2.5',
            side === 'right' ? 'flex-row-reverse pr-1.5' : 'pl-1.5',
          ),
        // Empty: hover thumbs stay absolute on the cloud (no permanent gap).
        !hasStack &&
          cn(
            'pointer-events-none absolute -bottom-2.5',
            side === 'right' ? 'right-1.5 flex-row-reverse' : 'left-1.5',
          ),
        className,
      )}
      data-testid="message-reactions"
    >
      {hasStack ? (
        <div
          className="group/stack relative flex items-center gap-0.5"
          onMouseEnter={canReact ? openMenu : undefined}
          onMouseLeave={canReact ? scheduleCloseMenu : undefined}
        >
          {aggregate.kinds.map((entry) => {
            const names = entry.reactors.map((r) => r.name).filter(Boolean)
            const tip =
              names.length > 0
                ? `${labelFor[entry.kind]}: ${names.join(', ')}${
                    entry.count > names.length ? ` +${entry.count - names.length}` : ''
                  }`
                : labelFor[entry.kind]
            const showCount = entry.count > 1
            return (
              <span key={entry.kind} className="inline-flex items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={busy || !canReact}
                      aria-label={tip}
                      aria-expanded={canReact ? menuOpen : undefined}
                      aria-haspopup={canReact ? 'menu' : undefined}
                      onClick={() => {
                        if (canReact) void pick(entry.kind)
                      }}
                      className={cn(
                        CHIP_CLASS,
                        'text-text-primary transition-colors',
                        canReact && 'hover:bg-bg-hover/80',
                        aggregate.mine === entry.kind && 'ring-1 ring-accent/45',
                        !canReact && 'cursor-default',
                      )}
                    >
                      <span aria-hidden="true" className={EMOJI_GLYPH_CLASS}>
                        {entry.emoji || REACTION_EMOJI[entry.kind]}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{tip}</TooltipContent>
                </Tooltip>
                {showCount ? (
                  <span
                    className={cn(
                      'overflow-hidden text-[10px] font-semibold tabular-nums text-text-secondary transition-[max-width,opacity,margin] duration-150',
                      'max-w-0 opacity-0 group-hover/stack:ml-1 group-hover/stack:max-w-[2rem] group-hover/stack:opacity-100',
                      'focus-within:ml-1 focus-within:max-w-[2rem] focus-within:opacity-100',
                    )}
                  >
                    {entry.count}
                  </span>
                ) : null}
              </span>
            )
          })}
          {palette}
        </div>
      ) : canReact ? (
        <div
          className={cn(
            'relative',
            !menuOpen &&
              'pointer-events-none opacity-0 transition-opacity duration-100 group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
            menuOpen && 'pointer-events-auto opacity-100',
          )}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleCloseMenu}
        >
          <button
            type="button"
            disabled={busy}
            aria-label={labelFor.up}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onFocus={openMenu}
            onClick={() => void pick('up')}
            className={cn(CHIP_CLASS, 'text-text-primary transition-colors hover:bg-bg-hover/80')}
          >
            <span aria-hidden="true" className={EMOJI_GLYPH_CLASS}>
              {REACTION_EMOJI.up}
            </span>
          </button>
          {palette}
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
