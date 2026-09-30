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
      ? 'border-accent/35 bg-accent/10 text-accent'
      : state === 'off'
        ? 'border-border/60 bg-bg-elevated/50 text-text-muted'
        : 'border-ai/25 bg-ai/10 text-ai-ink'

  const icon =
    state === 'paused' ? (
      <Hand size={10} className="shrink-0" />
    ) : state === 'off' ? (
      <ShieldOff size={10} className="shrink-0" />
    ) : (
      <AiMark size={10} />
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          title={hint}
          aria-label={label}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-105 disabled:opacity-50 ${tone}`}
        >
          {icon}
          <span className="max-w-[10rem] truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <p className="px-2 py-1.5 text-[11px] leading-snug text-text-muted">{hint}</p>
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
