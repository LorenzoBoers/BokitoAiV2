import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bot, Hand, Settings2, ShieldOff } from 'lucide-react'
import { AiMark } from '../ai/AiMark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

export type AiMode = 'suggest' | 'auto' | 'off' | null

type Props = {
  /** Effective channel AI mode for this conversation. */
  aiMode: AiMode
  /** True while a human holds the conversation and the AI stays quiet. */
  aiPaused?: boolean
  /** Used to tell "you took over" from "a colleague took over". */
  assignedToUserId?: number | null
  channel?: string | null
  onTakeover?: () => void | Promise<void>
  onHandBack?: () => void | Promise<void>
  saving?: boolean
}

/** Channels where an AI mode is meaningful; elsewhere the chip stays hidden. */
const AI_CHANNELS = ['email', 'widget', 'chat', 'whatsapp', 'assistant', 'webchat', 'livechat']

export default function AiStatusChip({
  aiMode,
  aiPaused = false,
  assignedToUserId = null,
  channel,
  onTakeover,
  onHandBack,
  saving = false,
}: Props) {
  const { t } = useTranslation('communication')

  if (!AI_CHANNELS.includes((channel ?? '').toLowerCase())) return null

  const state: 'paused' | 'auto' | 'suggest' | 'off' = aiPaused
    ? 'paused'
    : aiMode === 'auto'
      ? 'auto'
      : aiMode === 'off'
        ? 'off'
        : 'suggest'

  const label =
    state === 'paused'
      ? assignedToUserId == null
        ? t('aiStatus.pausedUnassigned')
        : t('aiStatus.paused')
      : state === 'auto'
        ? t('aiStatus.auto')
        : state === 'off'
          ? t('aiStatus.off')
          : t('aiStatus.suggest')

  const hint =
    state === 'paused'
      ? t('aiStatus.pausedHint')
      : state === 'auto'
        ? t('aiStatus.autoHint')
        : state === 'off'
          ? t('aiStatus.offHint')
          : t('aiStatus.suggestHint')

  const tone =
    state === 'paused'
      ? 'text-accent'
      : state === 'off'
        ? 'text-text-muted'
        : 'text-ai-ink'

  const icon =
    state === 'paused' ? (
      <Hand size={11} className={`shrink-0 ${tone}`} />
    ) : state === 'off' ? (
      <ShieldOff size={11} className={`shrink-0 ${tone}`} />
    ) : (
      <span className={tone}>
        <AiMark size={11} />
      </span>
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          title={hint}
          aria-label={label}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2 text-xs font-medium text-text-heading transition-colors hover:bg-bg-hover/70 disabled:opacity-50"
        >
          {icon}
          <span className="max-w-[10rem] truncate-fade">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <p className="px-2 py-1.5 text-xs leading-snug text-text-muted">{hint}</p>
        {state === 'paused' ? (
          onHandBack ? (
            <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void onHandBack()}>
              <Bot size={13} />
              {t('aiStatus.handBack')}
            </DropdownMenuItem>
          ) : null
        ) : onTakeover ? (
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void onTakeover()}>
            <Hand size={13} />
            {t('aiStatus.takeOver')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2 text-xs">
          <Link to="/settings/communication">
            <Settings2 size={13} />
            {t('aiStatus.openSettings')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
